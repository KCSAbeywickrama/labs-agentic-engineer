/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import type { PropsWithChildren } from "react";
import { AuthProvider as OidcProvider } from "react-oidc-context";
import type { User } from "oidc-client-ts";
import { env } from "../config/env";
import { router } from "../router";
import { getUserManager } from "./userManager";

// After the code exchange, land where the user originally asked to go
// (stashed in OAuth state by AuthGuard/redirectToSignIn) instead of
// staying on /callback.
function onSigninCallback(user: User | undefined): void {
  const returnTo =
    (user?.state as { returnTo?: string } | undefined)?.returnTo ?? "/";
  router.history.replace(returnTo);
}

// Outermost provider (issue #91): thunder mode wraps the app in
// react-oidc-context around the shared UserManager; mock mode needs no
// provider at all — AuthGuard supplies the fixed dev session.
export function AppAuthProvider({ children }: PropsWithChildren) {
  if (env.authMode === "mock") {
    return children;
  }
  return (
    <OidcProvider
      userManager={getUserManager()}
      onSigninCallback={onSigninCallback}
    >
      {children}
    </OidcProvider>
  );
}
