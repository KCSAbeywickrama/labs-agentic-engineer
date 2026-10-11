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

package runread_test

import (
	"reflect"
	"testing"

	"github.com/wso2/aep/aep-api/internal/delivery"
	"github.com/wso2/aep/aep-api/internal/delivery/runread"
	"github.com/wso2/aep/aep-api/internal/gen"
)

// A cycle merged on `Advances #N` alone shows the build issue it advanced,
// and keeps it out of `resolves`: the console reads that list as what the
// merge closed, and the build issue is still open.
func TestCycleView_CarriesWhatTheCycleAdvancedApartFromWhatItResolved(t *testing.T) {
	t.Parallel()

	row := &delivery.RunCycle{ID: "c1", Kind: delivery.CycleKindCoding, MergeSHA: "abc", Advances: delivery.IssueNumbers{10}}
	view := runread.CycleView(row, gen.RunCycleViewRecordingKept)
	if !reflect.DeepEqual(view.Advances, []int64{10}) || len(view.Resolves) != 0 {
		t.Fatalf("view resolves %v advances %v, want none resolved and #10 advanced", view.Resolves, view.Advances)
	}

	row = &delivery.RunCycle{ID: "c2", Kind: delivery.CycleKindCoding, Resolves: delivery.IssueNumbers{12, 13}}
	view = runread.CycleView(row, gen.RunCycleViewRecordingKept)
	if !reflect.DeepEqual(view.Resolves, []int64{12, 13}) || len(view.Advances) != 0 {
		t.Fatalf("view resolves %v advances %v, want #12 #13 resolved and nothing advanced", view.Resolves, view.Advances)
	}
}
