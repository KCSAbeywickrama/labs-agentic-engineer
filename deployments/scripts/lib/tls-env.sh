# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

# Scheme and gateway ports for one cluster, derived from WITH_TLS.
#
#   source "${SCRIPT_DIR}/lib/tls-env.sh"
#
# Sourced rather than copied because the setup scripts are separate operator
# entrypoints that must agree: setup-env-for-aectl.sh provisions the gateways
# and certificates, and setup-agent-manager.sh installs against them later,
# from a different shell. If the two disagree about the port, nothing fails at
# install time — Agent Manager simply registers URLs nobody can reach, and the
# first symptom is a browser console full of blocked requests.
#
# Idempotent and safe to source twice: a script that exports these for a child
# script it calls does not fight the child re-deriving them.

WITH_TLS="${WITH_TLS:-0}"
if [ "$WITH_TLS" = "1" ]; then
    SCHEME="https"
    CP_PORT=8443     # control plane: consoles, ThunderID, the environment IdP
    DP_PORT=19443    # data plane: deployed components and agents
    DP_LISTENER="https"
else
    SCHEME="http"
    CP_PORT=8080
    DP_PORT=19080
    DP_LISTENER="http"
fi

# The observability plane keeps one plain-HTTP listener on 11080 whether or not
# the rest of the cluster is on TLS, so it is derived separately rather than
# following SCHEME. Anything a BROWSER fetches from here is therefore mixed
# content on a TLS cluster and will be blocked; server-to-server callers are
# unaffected. Raising this to HTTPS needs a certificate and listener on that
# plane's own Gateway, which the install does not create today.
OBS_SCHEME="http"
OBS_PORT=11080

export WITH_TLS SCHEME CP_PORT DP_PORT DP_LISTENER OBS_SCHEME OBS_PORT
