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

package main

import (
	"context"
	"fmt"

	"github.com/wso2/aep/aepctl/internal/adminpb"
	"github.com/wso2/aep/aepctl/internal/openbao"
)

func (s *server) OpenbaoUnseal(ctx context.Context, req *adminpb.UnsealRequest) (*adminpb.UnsealResponse, error) {
	if len(req.Keys) == 0 {
		return &adminpb.UnsealResponse{Success: false, Message: "no keys provided"}, nil
	}

	for i, key := range req.Keys {
		resp, _, err := openbao.Req(ctx, "PUT", s.openbaoAddr, "", "/v1/sys/unseal", map[string]interface{}{
			"key": key,
		})
		if err != nil {
			return &adminpb.UnsealResponse{
				Success: false,
				Message: fmt.Sprintf("unseal key %d: %v", i+1, err),
			}, nil
		}

		sealed, _ := resp["sealed"].(bool)
		if !sealed {
			return &adminpb.UnsealResponse{
				Success: true,
				Message: "OpenBao unsealed successfully",
			}, nil
		}
	}

	return &adminpb.UnsealResponse{
		Success: false,
		Message: "keys applied but OpenBao is still sealed (need threshold keys — provide at least 3)",
	}, nil
}
