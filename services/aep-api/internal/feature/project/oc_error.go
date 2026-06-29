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

package project

import (
	"errors"
	"net/http"

	"github.com/wso2/asdlc/asdlc-service/clients/openchoreo"
)

// openchoreoErrorStatus maps an OC sentinel error to its HTTP status. ok is
// false when err is not a recognized OC sentinel.
func openchoreoErrorStatus(err error) (int, bool) {
	switch {
	case errors.Is(err, openchoreo.ErrBadRequest):
		return http.StatusBadRequest, true
	case errors.Is(err, openchoreo.ErrForbidden):
		return http.StatusForbidden, true
	case errors.Is(err, openchoreo.ErrNotFound):
		return http.StatusNotFound, true
	case errors.Is(err, openchoreo.ErrConflict):
		return http.StatusConflict, true
	case errors.Is(err, openchoreo.ErrInternalServerError):
		return http.StatusInternalServerError, true
	}
	return 0, false
}
