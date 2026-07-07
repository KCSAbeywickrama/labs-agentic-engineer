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

// Command thunder-app-operator reconciles ThunderApplication custom
// resources into OAuth clients on the platform Thunder IdP.
//
// This is a scaffold stub: the manager, reconciler and Thunder REST client
// are wired up in later tasks. For now the binary only registers the
// aep.wso2.com/v1alpha1 scheme and sets up the controller-runtime logger so
// the module builds and the API types are importable by dependents.
package main

import (
	"log/slog"
	"os"

	"k8s.io/apimachinery/pkg/runtime"

	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

	thunderv1alpha1 "github.com/wso2/aep/thunder-app-operator/api/v1alpha1"
)

func main() {
	ctrl.SetLogger(zap.New())

	scheme := runtime.NewScheme()
	if err := thunderv1alpha1.AddToScheme(scheme); err != nil {
		slog.Error("failed to register aep.wso2.com/v1alpha1 scheme", "error", err)
		os.Exit(1)
	}

	slog.Info("thunder-app-operator scaffold: reconciler not yet wired up (see later tasks)")
}
