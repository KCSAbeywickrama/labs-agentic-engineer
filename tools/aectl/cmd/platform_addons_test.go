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
	"errors"
	"testing"

	"github.com/wso2/aep/aectl/internal/addons"
	"github.com/wso2/aep/aectl/internal/ui"
)

// fakeApplier is a manifestApplier that records every ApplyYAML call and
// answers Exists from a pre-populated set.
type fakeApplier struct {
	applied  []string        // YAML strings passed to ApplyYAML, in order
	existing map[string]bool // "Kind/Name" → whether Exists returns true
}

func (f *fakeApplier) ApplyYAML(_ context.Context, _, _, manifest string) error {
	f.applied = append(f.applied, manifest)
	return nil
}

func (f *fakeApplier) Exists(_ context.Context, _, kind, _, name string) (bool, error) {
	return f.existing[kind+"/"+name], nil
}

// selectFirst returns deps.multiSelect that selects the first addon only.
func selectFirst(available []addons.Addon) func(string, []ui.SelectItem) ([]bool, bool) {
	return func(_ string, items []ui.SelectItem) ([]bool, bool) {
		sel := make([]bool, len(items))
		if len(sel) > 0 {
			sel[0] = true
		}
		return sel, true
	}
}

// existingForAddon pre-populates the fakeApplier with all VerifyResources of a.
func existingForAddon(a addons.Addon) map[string]bool {
	m := make(map[string]bool, len(a.VerifyResources))
	for _, v := range a.VerifyResources {
		m[v.Kind+"/"+v.Name] = true
	}
	return m
}

// TestRunAddonInstall_DeclinedConfirmation verifies that when the user
// declines the operator-install prompt, installAddons returns nil and never
// calls newApplier or applies any manifest.
func TestRunAddonInstall_DeclinedConfirmation(t *testing.T) {
	newApplierCalled := false
	deps := addonDeps{
		multiSelect: selectFirst(addons.Available),
		confirm:     func(string) bool { return false },
		installOperator: func(context.Context, string, addons.OperatorSpec) error {
			t.Error("installOperator must not be called when confirmation is declined")
			return nil
		},
		newApplier: func(string) (manifestApplier, error) {
			newApplierCalled = true
			return nil, errors.New("should not be called")
		},
	}

	if err := runAddonInstall(context.Background(), deps); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
	if newApplierCalled {
		t.Error("newApplier must not be called when operator confirmation is declined")
	}
}

// TestRunAddonInstall_OperatorFailureSkipsAddon verifies that when an operator
// install fails, its dependent addon is skipped and the function returns nil
// (other addons that succeed would still be applied; here only one is selected).
func TestRunAddonInstall_OperatorFailureSkipsAddon(t *testing.T) {
	first := addons.Available[0] // thunder-app — has an operator dependency

	fa := &fakeApplier{existing: existingForAddon(first)}
	installCalled := false
	deps := addonDeps{
		multiSelect: selectFirst(addons.Available),
		confirm:     func(string) bool { return true },
		installOperator: func(_ context.Context, _ string, op addons.OperatorSpec) error {
			installCalled = true
			return errors.New("simulated operator install failure")
		},
		newApplier: func(string) (manifestApplier, error) {
			return fa, nil
		},
	}

	if err := runAddonInstall(context.Background(), deps); err != nil {
		t.Fatalf("expected nil (failed operator is not a fatal error), got %v", err)
	}
	if !installCalled {
		t.Error("installOperator must be called")
	}
	if len(fa.applied) != 0 {
		t.Errorf("expected no manifests applied after operator failure, got %d", len(fa.applied))
	}
}

// TestRunAddonInstall_SuccessAppliesManifests verifies that when the operator
// installs successfully, all manifests for the selected addon are applied.
func TestRunAddonInstall_SuccessAppliesManifests(t *testing.T) {
	first := addons.Available[0] // thunder-app

	fa := &fakeApplier{existing: existingForAddon(first)}
	deps := addonDeps{
		multiSelect: selectFirst(addons.Available),
		confirm:     func(string) bool { return true },
		installOperator: func(context.Context, string, addons.OperatorSpec) error {
			return nil
		},
		newApplier: func(string) (manifestApplier, error) {
			return fa, nil
		},
	}

	if err := runAddonInstall(context.Background(), deps); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, want := len(fa.applied), len(first.Manifests); got != want {
		t.Errorf("applied %d manifests, want %d", got, want)
	}
}
