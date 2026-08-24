import { format as formatDate } from "date-fns";
import { useState, useRef, useEffect, useMemo } from "react";
import type { locales } from "@shared/utils/date";
import { dateLocale, dateToRelative } from "@shared/utils/date";
import useUserLocale from "~/hooks/useUserLocale";

let callbacks: (() => void)[] = [];

// This is a shared timer that fires every minute, used for
// updating all Time components across the page all at once.
setInterval(() => {
  callbacks.forEach((cb) => cb());
}, 1000 * 60);

function eachMinute(fn: () => void) {
  callbacks.push(fn);

  return () => {
    callbacks = callbacks.filter((cb) => cb !== fn);
  };
}

const dateFormatLong: Record<string, string> = {
  en_US: "MMMM do, yyyy h:mm a",
  fr_FR: "'Le 'd MMMM yyyy 'à' H:mm",
  de_DE: "d. MMMM yyyy 'um' H:mm",
};

export type Props = {
  dateTime: string;
  addSuffix?: boolean;
  shorten?: boolean;
  relative?: boolean;
  format?: Partial<Record<keyof typeof locales, string>>;
};

export const useLocaleTime = ({
  addSuffix,
  dateTime,
  shorten,
  format,
  relative,
}: Props) => {
  const userLocale = useUserLocale();
  const formatLocaleLong =
    (userLocale ? dateFormatLong[userLocale] : undefined) ??
    "MMMM do, yyyy h:mm a";
  // @ts-expect-error fallback to formatLocaleLong
  const formatLocale = format?.[userLocale] ?? formatLocaleLong;
  // The count of minutes since mount changes whenever the shared timer ticks,
  // which keeps relative labels fresh without recomputing on other renders.
  const [minutesMounted, setMinutesMounted] = useState(0);
  const callback = useRef<() => void>();

  useEffect(() => {
    callback.current = eachMinute(() => {
      setMinutesMounted((state) => ++state);
    });
    return () => {
      if (callback.current) {
        callback.current?.();
      }
    };
  }, []);

  return useMemo(() => {
    const date = new Date(Date.parse(dateTime));
    const locale = dateLocale(userLocale);
    const relativeContent = dateToRelative(date, {
      addSuffix,
      locale,
      shorten,
    });

    const tooltipContent = formatDate(date, formatLocaleLong, {
      locale,
    });
    const content =
      relative !== false
        ? relativeContent
        : formatDate(date, formatLocale, {
            locale,
          });

    return {
      content,
      tooltipContent,
    };
    // minutesMounted is intentionally included: it advances on the shared
    // minute tick so relative labels stay current.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dateTime,
    userLocale,
    addSuffix,
    shorten,
    relative,
    formatLocale,
    formatLocaleLong,
    minutesMounted,
  ]);
};
