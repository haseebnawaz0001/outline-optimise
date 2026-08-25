import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Redirect, useLocation } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import { UserPreference } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import type { Config } from "~/stores/AuthStore";
import { AvatarSize } from "~/components/Avatar";
import ButtonLarge from "~/components/ButtonLarge";
import ChangeLanguage from "~/components/ChangeLanguage";
import Heading from "~/components/Heading";
import OutlineIcon from "~/components/Icons/OutlineIcon";
import InputLarge from "~/components/InputLarge";
import LoadingIndicator from "~/components/LoadingIndicator";
import PageTitle from "~/components/PageTitle";
import TeamLogo from "~/components/TeamLogo";
import Text from "~/components/Text";
import env from "~/env";
import useCurrentUser from "~/hooks/useCurrentUser";
import {
  useLastVisitedPath,
  usePostLoginPath,
} from "~/hooks/useLastVisitedPath";
import useStores from "~/hooks/useStores";
import isCloudHosted from "~/utils/isCloudHosted";
import { detectLanguage } from "~/utils/language";
import { homePath } from "~/utils/routeHelpers";
import { BackButton } from "./components/BackButton";
import { Background } from "./components/Background";
import { Centered } from "./components/Centered";
import { Notices } from "./components/Notices";
import { SwitchHostButton } from "./components/SwitchHostButton";
import lazyWithRetry from "~/utils/lazyWithRetry";

const WorkspaceSetup = lazyWithRetry(
  () => import("./components/WorkspaceSetup")
);

type Props = {
  children?: (config?: Config) => React.ReactNode;
  onBack?: () => void;
};

type Mode = "signin" | "signup";

interface ErrorBody {
  message?: unknown;
  error?: unknown;
}

/**
 * Extracts a human-readable message from a better-auth error response, which
 * returns a JSON body containing either a {@link message} or {@link error} key.
 *
 * @param response The failed fetch response.
 * @returns the error message, or an empty string if none could be read.
 */
async function readErrorMessage(response: Response): Promise<string> {
  const body: ErrorBody | null = await response
    .json()
    .catch(() => null);

  if (typeof body?.message === "string") {
    return body.message;
  }
  if (typeof body?.error === "string") {
    return body.error;
  }
  return "";
}

/**
 * Reads a text field from a submitted HTML form.
 *
 * @param entries The form entries.
 * @param key The name of the field to read.
 * @returns the field value, or an empty string when absent.
 */
function formValue(
  entries: { [k: string]: FormDataEntryValue },
  key: string
): string {
  const entry = entries[key];
  return typeof entry === "string" ? entry : "";
}

function Login({ children, onBack }: Props) {
  const location = useLocation();
  const { t } = useTranslation();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const { auth } = useStores();
  const { config } = auth;
  const [mode, setMode] = React.useState<Mode>("signin");
  const [error, setError] = React.useState(null);
  const [formError, setFormError] = React.useState<string | undefined>(
    undefined
  );
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const rememberLastPath = !!user?.getPreference(
    UserPreference.RememberLastPath
  );
  const [lastVisitedPath] = useLastVisitedPath();
  const [spendPostLoginPath] = usePostLoginPath();

  React.useEffect(() => {
    auth.fetchConfig().catch(setError);
  }, [auth]);

  React.useEffect(() => {
    if (config?.passwordSigninEnabled === false) {
      setMode("signup");
    }
  }, [config]);

  const handleShowSignIn = () => {
    setMode("signin");
    setFormError(undefined);
  };

  const handleShowSignUp = () => {
    setMode("signup");
    setFormError(undefined);
  };

  const handleSubmitAuth = async (
    path: string,
    data: Record<string, string>
  ) => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setFormError(undefined);

    try {
      const response = await window.fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const message = await readErrorMessage(response);
        setFormError(message || t("Sorry, an unknown error occurred."));
        return;
      }

      await auth.fetchAuth();
    } catch (_err) {
      setFormError(t("Sorry, an unknown error occurred."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignIn = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = Object.fromEntries(new FormData(event.currentTarget));
    void handleSubmitAuth("/api/auth/sign-in/email", {
      email: formValue(entries, "email"),
      password: formValue(entries, "password"),
    });
  };

  const handleSignUp = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = Object.fromEntries(new FormData(event.currentTarget));
    void handleSubmitAuth("/api/auth/sign-up/email", {
      name: formValue(entries, "name"),
      email: formValue(entries, "email"),
      password: formValue(entries, "password"),
      signupKey: formValue(entries, "signupKey"),
    });
  };

  if (auth.authenticated) {
    const postLoginPath = spendPostLoginPath();
    if (postLoginPath) {
      return <Redirect to={postLoginPath} />;
    }

    if (rememberLastPath && lastVisitedPath !== location.pathname) {
      return <Redirect to={lastVisitedPath} />;
    }

    if (auth.team?.defaultCollectionId) {
      return <Redirect to={`/collection/${auth.team?.defaultCollectionId}`} />;
    }

    return <Redirect to={homePath()} />;
  }

  if (error) {
    return (
      <Background>
        <BackButton onBack={onBack} />
        <ChangeLanguage locale={detectLanguage()} />
        <SwitchHostButton />
        <Centered>
          <PageTitle title={t("Login")} />
          <Heading centered>{t("Error")}</Heading>
          <Note>
            {t("Failed to load configuration.")}
            {!isCloudHosted && (
              <p>
                {t(
                  "Check the network requests and server logs for full details of the error."
                )}
              </p>
            )}
          </Note>
        </Centered>
      </Background>
    );
  }

  // we're counting on the config request being fast, so just a simple loading
  // indicator here that's delayed by 250ms
  if (!config) {
    return <LoadingIndicator />;
  }

  const isCustomDomain = parseDomain(window.location.origin).custom;

  // Unmapped custom domain
  if (isCloudHosted && isCustomDomain && !config.name) {
    return (
      <Background>
        <BackButton onBack={onBack} config={config} />
        <ChangeLanguage locale={detectLanguage()} />
        <Centered>
          <PageTitle title={t("Custom domain setup")} />
          <Heading centered>{t("Almost there")}…</Heading>
          <Note>
            {t(
              "Your custom domain is successfully pointing at Outline. To complete the setup process please contact support."
            )}
          </Note>
        </Centered>
      </Background>
    );
  }

  const firstRun = !isCloudHosted && !config.name;

  if (firstRun) {
    return (
      <React.Suspense fallback={null}>
        <WorkspaceSetup onBack={onBack} />
      </React.Suspense>
    );
  }

  return (
    <Background>
      <BackButton onBack={onBack} config={config} />
      <ChangeLanguage locale={detectLanguage()} />

      <Centered gap={12}>
        <PageTitle
          title={config.name ? `${config.name} – ${t("Login")}` : t("Login")}
        />
        <Logo>
          {config.logo ? (
            <TeamLogo size={AvatarSize.XXLarge} src={config.logo} />
          ) : (
            <OutlineIcon size={AvatarSize.XXLarge} />
          )}
        </Logo>
        <StyledHeading as="h2" centered>
          {t("Login to {{ authProviderName }}", {
            authProviderName: config.name || env.APP_NAME,
          })}
        </StyledHeading>
        {children?.(config)}
        <Notices />

        <Tabs>
          <TabButton
            type="button"
            $active={mode === "signin"}
            onClick={handleShowSignIn}
          >
            {t("Sign in")}
          </TabButton>
          <TabButton
            type="button"
            $active={mode === "signup"}
            onClick={handleShowSignUp}
          >
            {t("Sign up")}
          </TabButton>
        </Tabs>

        {mode === "signin" ? (
          <Form onSubmit={handleSignIn}>
            <Field
              type="email"
              name="email"
              placeholder={t("Email")}
              autoComplete="email"
              autoFocus
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <Field
              type="password"
              name="password"
              placeholder={t("Password")}
              autoComplete="current-password"
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <ButtonLarge type="submit" disabled={isSubmitting} fullwidth>
              {t("Sign in")}
            </ButtonLarge>
          </Form>
        ) : (
          <Form onSubmit={handleSignUp}>
            <Field
              type="text"
              name="name"
              placeholder={t("Name")}
              autoComplete="name"
              autoFocus
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <Field
              type="email"
              name="email"
              placeholder={t("Email")}
              autoComplete="email"
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <Field
              type="password"
              name="password"
              placeholder={t("Password")}
              autoComplete="new-password"
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <Field
              type="text"
              name="signupKey"
              placeholder={t("Signup key")}
              autoComplete="off"
              disabled={isSubmitting}
              required
              margin="0 0 12px"
            />
            <ButtonLarge type="submit" disabled={isSubmitting} fullwidth>
              {t("Create account")}
            </ButtonLarge>
          </Form>
        )}
        {formError && <FormError>{formError}</FormError>}
      </Centered>
    </Background>
  );
}

const StyledHeading = styled(Heading)`
  margin: 0;
`;

const Logo = styled.div`
  margin-bottom: -4px;
`;

const Note = styled(Text)`
  color: ${s("textTertiary")};
  text-align: center;
  font-size: 14px;
  margin-top: 8px;
`;

const Tabs = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 8px;
`;

const TabButton = styled.button<{ $active?: boolean }>`
  appearance: none;
  background: none;
  border: 0;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: ${(props) =>
    props.$active ? s("text")(props) : s("textTertiary")(props)};

  &:hover,
  &:focus-visible {
    color: ${s("text")};
  }
`;

const Form = styled.form`
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const Field = styled(InputLarge)`
  width: 100%;
  margin-right: 0;
`;

const FormError = styled(Text)`
  color: ${s("danger")};
  text-align: center;
  font-size: 14px;
  margin-top: 12px;
`;

export default observer(Login);
