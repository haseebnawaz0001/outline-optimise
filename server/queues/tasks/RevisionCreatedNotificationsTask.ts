import { subHours } from "date-fns";
import { differenceBy } from "es-toolkit/compat";
import { Op } from "sequelize";
import { MentionType, NotificationEventType } from "@shared/types";
import {
  createSubscriptionsForDocument,
  subscribeUsersToDocument,
} from "@server/commands/subscriptionCreator";
import env from "@server/env";
import Logger from "@server/logging/Logger";
import {
  Document,
  Group,
  Revision,
  Notification,
  User,
  View,
  GroupUser,
} from "@server/models";
import { DocumentHelper } from "@server/models/helpers/DocumentHelper";
import NotificationHelper from "@server/models/helpers/NotificationHelper";
import type { RevisionEvent } from "@server/types";
import { canUserAccessDocument } from "@server/utils/permissions";
import { BaseTask, TaskPriority } from "./base/BaseTask";

export default class RevisionCreatedNotificationsTask extends BaseTask<RevisionEvent> {
  public async perform(event: RevisionEvent) {
    const [document, revision] = await Promise.all([
      Document.findByPk(event.documentId, { includeState: true }),
      Revision.findByPk(event.modelId),
    ]);

    if (!document || !revision) {
      return;
    }

    await createSubscriptionsForDocument(document, event);

    const before = await revision.before();

    // Send notifications to mentioned users first – these must be processed
    // regardless of the change threshold as even a small edit can add a mention.
    const oldMentions = before
      ? [...DocumentHelper.parseMentions(before, { type: MentionType.User })]
      : [];
    const newMentions = [
      ...DocumentHelper.parseMentions(document, {
        type: MentionType.User,
      }),
    ];

    const mentions = differenceBy(newMentions, oldMentions, "id");
    const userIdsProcessed = new Set<string>();
    const userIdsMentioned: string[] = [];
    const usersToSubscribe: User[] = [];
    const mentionedUsersById = await this.getUsersById(
      mentions.map((mention) => mention.modelId)
    );

    for (const mention of mentions) {
      if (userIdsProcessed.has(mention.modelId)) {
        continue;
      }
      userIdsProcessed.add(mention.modelId);

      const recipient = mentionedUsersById.get(mention.modelId);

      if (
        !recipient ||
        recipient.id === mention.actorId ||
        !(await canUserAccessDocument(recipient, document.id))
      ) {
        continue;
      }

      usersToSubscribe.push(recipient);

      if (
        recipient.subscribedToEventType(
          NotificationEventType.MentionedInDocument
        )
      ) {
        await Notification.create({
          event: NotificationEventType.MentionedInDocument,
          userId: recipient.id,
          revisionId: event.modelId,
          actorId: mention.actorId,
          teamId: document.teamId,
          documentId: document.id,
        });

        userIdsMentioned.push(recipient.id);
      }
    }

    await subscribeUsersToDocument(usersToSubscribe, document, event);

    // Send notifications to users in mentioned groups
    const oldGroupMentions = before
      ? DocumentHelper.parseMentions(before, { type: MentionType.Group })
      : [];
    const newGroupMentions = DocumentHelper.parseMentions(document, {
      type: MentionType.Group,
    });

    const groupMentions = differenceBy(
      newGroupMentions,
      oldGroupMentions,
      "id"
    );
    const mentionedGroup: string[] = [];

    // Load all mentioned groups and their members in batch.
    const groupIds = [...new Set(groupMentions.map((group) => group.modelId))];
    const groupsById = new Map<string, Group>();
    const membersByGroupId = new Map<string, GroupUser[]>();

    if (groupIds.length > 0) {
      const [groups, groupUsers] = await Promise.all([
        Group.findAll({
          where: {
            id: {
              [Op.in]: groupIds,
            },
          },
        }),
        GroupUser.findAll({
          where: {
            groupId: {
              [Op.in]: groupIds,
            },
          },
          include: [
            {
              association: "user",
              required: false,
            },
          ],
          order: [["permission", "ASC"]],
        }),
      ]);

      for (const group of groups) {
        groupsById.set(group.id, group);
      }

      for (const member of groupUsers) {
        const members = membersByGroupId.get(member.groupId);
        if (members) {
          members.push(member);
        } else {
          membersByGroupId.set(member.groupId, [member]);
        }
      }
    }

    for (const group of groupMentions) {
      if (mentionedGroup.includes(group.modelId)) {
        continue;
      }

      // Check if the group has mentions disabled
      const groupModel = groupsById.get(group.modelId);
      if (groupModel?.disableMentions) {
        continue;
      }

      const usersFromMentionedGroup = membersByGroupId.get(group.modelId) ?? [];

      const mentionedUser: string[] = [];
      for (const user of usersFromMentionedGroup) {
        if (mentionedUser.includes(user.userId)) {
          continue;
        }

        const recipient = user.user;
        if (
          recipient &&
          recipient.id !== group.actorId &&
          recipient.subscribedToEventType(
            NotificationEventType.GroupMentionedInDocument
          ) &&
          (await canUserAccessDocument(recipient, document.id))
        ) {
          await Notification.create({
            event: NotificationEventType.GroupMentionedInDocument,
            groupId: group.modelId,
            userId: recipient.id,
            revisionId: event.modelId,
            actorId: group.actorId,
            teamId: document.teamId,
            documentId: document.id,
          });

          mentionedUser.push(user.userId);
        }
      }

      mentionedGroup.push(group.modelId);
    }

    // If the content change is insignificant, don't send generic update
    // notifications (mention notifications above are still sent).
    if (!DocumentHelper.isChangeOverThreshold(before, revision, 5)) {
      Logger.info(
        "processor",
        `suppressing update notifications as change has insignificant edits`
      );
      return;
    }

    const recipients = (
      await NotificationHelper.getDocumentNotificationRecipients({
        document,
        notificationType: NotificationEventType.UpdateDocument,
        actorId: document.lastModifiedById,
      })
    ).filter((recipient) => !userIdsMentioned.includes(recipient.id));
    if (!recipients.length) {
      return;
    }

    // Load notification and view suppression state for all recipients in
    // batch.
    const recipientIds = recipients.map((recipient) => recipient.id);
    const [recentNotifications, recentViews] = await Promise.all([
      Notification.findAll({
        where: {
          userId: {
            [Op.in]: recipientIds,
          },
          documentId: document.id,
          emailedAt: {
            [Op.not]: null,
            [Op.gte]: subHours(new Date(), 6),
          },
        },
      }),
      View.findAll({
        where: {
          userId: {
            [Op.in]: recipientIds,
          },
          documentId: document.id,
          updatedAt: {
            [Op.gt]: document.updatedAt,
          },
        },
      }),
    ]);

    const notifiedUserIds = new Set(
      recentNotifications.map((notification) => notification.userId)
    );
    const viewedUserIds = new Set(recentViews.map((view) => view.userId));

    for (const recipient of recipients) {
      // Create only a single notification in a 6 hour window
      if (notifiedUserIds.has(recipient.id)) {
        if (env.isDevelopment) {
          Logger.info(
            "processor",
            `would have suppressed notification to ${recipient.id}, but not in development`
          );
        } else {
          Logger.info(
            "processor",
            `suppressing notification to ${recipient.id} as recently notified`
          );
          continue;
        }
      }

      // If this recipient has viewed the document since the last update was
      // made then we can avoid sending them a useless notification, yay.
      if (viewedUserIds.has(recipient.id)) {
        Logger.info(
          "processor",
          `suppressing notification to ${recipient.id} because update viewed`
        );
        continue;
      }

      await Notification.create({
        event: NotificationEventType.UpdateDocument,
        userId: recipient.id,
        revisionId: event.modelId,
        actorId: document.updatedBy.id,
        teamId: document.teamId,
        documentId: document.id,
      });
    }
  }

  /**
   * Fetch users by their ids in a single query.
   *
   * @param ids The user ids to fetch, may contain duplicates.
   * @returns A map of user id to User, missing ids are absent from the map.
   */
  private getUsersById = async (ids: string[]): Promise<Map<string, User>> => {
    const uniqueIds = [...new Set(ids)];

    if (!uniqueIds.length) {
      return new Map();
    }

    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: uniqueIds,
        },
      },
    });

    return new Map(users.map((user) => [user.id, user]));
  };

  public get options() {
    return {
      priority: TaskPriority.Background,
    };
  }
}
