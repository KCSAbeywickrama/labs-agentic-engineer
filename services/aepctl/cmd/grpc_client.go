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

package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/spf13/viper"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/wso2/aep/aepctl/internal/adminpb"
)

// dialServer opens a gRPC connection to the configured AEP server.
func dialServer(ctx context.Context) (adminpb.AEPAdminClient, context.Context, func(), error) {
	serverURL := viper.GetString("server")
	if serverURL == "" {
		return nil, ctx, nil, fmt.Errorf("server not configured — run `aep connect --server <url>` first")
	}

	// grpc.NewClient expects host:port, not a full URL.
	target := strings.TrimPrefix(strings.TrimPrefix(serverURL, "https://"), "http://")

	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, ctx, nil, fmt.Errorf("dial %s: %w", serverURL, err)
	}

	return adminpb.NewAEPAdminClient(conn), ctx, func() { conn.Close() }, nil
}
