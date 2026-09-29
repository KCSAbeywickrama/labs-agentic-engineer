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

package delivery

import "errors"

// ErrNoWriteTarget is the dispatch refusal when the project's deployment
// pipeline names no environment to bind the coding agent's Job into. It is a
// configuration fact, like the deploy gate's (RunReasonNoWriteTarget): no
// re-dispatch can make the pipeline name one, so Temporal must not spend the
// re-dispatch budget on it. The resolver's own error is wrapped beside it.
var ErrNoWriteTarget = errors.New("no write target")

// ErrTypeNoWriteTarget is the Temporal ApplicationError TYPE the dispatch
// activity stamps. The workflow branches on the type because a sentinel does
// not survive the activity boundary.
const ErrTypeNoWriteTarget = "NoWriteTarget"
