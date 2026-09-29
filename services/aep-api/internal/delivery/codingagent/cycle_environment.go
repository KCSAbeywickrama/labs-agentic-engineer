// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package codingagent

import (
	"context"
	"errors"
	"log/slog"

	"github.com/wso2/aep/aep-api/internal/delivery"
)

// writeTargetResolver names the environment a project writes into: the root of
// its own deployment pipeline. Declared consumer-side so this package depends
// on the one method it uses; openchoreo.WriteTargets satisfies it.
type writeTargetResolver interface {
	Resolve(ctx context.Context, org, project string) (string, error)
}

// errNoWriteTargetResolver is a composition fault: a reader that needed the
// project's write target was wired without a resolver.
var errNoWriteTargetResolver = errors.New("codingagent: no write-target resolver configured")

// cycleEnvironment is the environment the cycle's Job was bound into. A cycle
// with none recorded (dispatched before the column existed, or whose launch
// write failed) falls back to the project's write target now.
func cycleEnvironment(ctx context.Context, targets writeTargetResolver, cycle *delivery.RunCycle) (string, error) {
	if cycle.Environment != "" {
		return cycle.Environment, nil
	}
	if targets == nil {
		return "", errNoWriteTargetResolver
	}
	env, err := targets.Resolve(ctx, cycle.OrgID, cycle.ProjectID)
	if err != nil {
		return "", err
	}
	slog.InfoContext(ctx, "codingagent: cycle has no recorded environment; using the project's write target",
		"cycle", cycle.ID, "environment", env)
	return env, nil
}
