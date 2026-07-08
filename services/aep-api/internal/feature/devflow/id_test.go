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

package devflow

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDevWorkflowID_StrictFormat(t *testing.T) {
	at := time.Date(2026, 7, 8, 22, 4, 39, 0, time.UTC)
	require.Equal(t,
		"devflow-20260708220439-acme-shop-v3",
		DevWorkflowID(at, "acme", "shop", "v3"))
}

func TestTaskWorkflowID_Format(t *testing.T) {
	require.Equal(t, "taskflow-acme-shop-v3-issue7", taskWorkflowID("acme", "shop", "v3", 7))
}
