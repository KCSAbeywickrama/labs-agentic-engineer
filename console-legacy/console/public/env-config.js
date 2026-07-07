// Local-dev runtime config for the Vite dev server (the docker console
// generates its own copy at container start — see deployments/). Served
// verbatim from public/; index.html loads it before the app bundle.
window._env_ = {
  VITE_CORE_API_BASE_URL: "/aep-api-service",
  VITE_THUNDER_URL: "http://thunder.openchoreo.localhost:8080",
  VITE_THUNDER_CLIENT_ID: "aep-console-client",
  VITE_THUNDER_SCOPES: "openid profile email",
  VITE_DEV_BYPASS_AUTH: "",
  BILLING_API_BASE_URL: "",
  VITE_SIGN_IN_REDIRECT_URL: "http://localhost:8091",
  VITE_SIGN_OUT_REDIRECT_URL: "http://localhost:8091/login",
};
