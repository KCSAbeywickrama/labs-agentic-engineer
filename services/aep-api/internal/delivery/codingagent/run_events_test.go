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
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/gen"
)

// TestPlatformNoticeCarriesARealInstant pins the ONE fact every platform-minted
// event on this feed has to get right, and it is pinned on the WIRE FORM because
// that is where it went wrong.
//
// `RunEvent.ts` is required by the contract and generates as a `time.Time`, so a
// notice built without one does not omit the field: it marshals Go's zero value
// into `0001-01-01T00:00:00Z`, a perfectly well-formed date that no consumer can
// tell from a real one. A console did exactly what it should with it and
// subtracted it from the clock, and because these notices belong to the lead,
// the lead's age column read `1065409035m47s` — the 2026 years from Go's zero
// time to the afternoon someone was watching a live run.
//
// So: a real instant, or the field would have to be absent, and the contract
// does not allow absent. The platform is the producer of these events and it
// knows when it derived each one, which makes the real instant the honest answer
// rather than merely the safe one.
func TestPlatformNoticeCarriesARealInstant(t *testing.T) {
	t.Parallel()

	at := time.Date(2026, 9, 9, 9, 15, 47, 0, time.UTC)
	notices := map[string]gen.RunEvent{
		"gap in the feed": feedGapNotice(at, 7, 3),
		"bare":            platformNotice(at, 9, gen.RunEventLevelInfo, "something the platform wants to say"),
	}
	for name, ev := range notices {
		t.Run(name, func(t *testing.T) {
			if !ev.TS.Equal(at) {
				t.Errorf("%s notice is stamped %s, want the instant its caller derived it (%s)", name, ev.TS, at)
			}
			// The wire form, because a struct field that reads fine in Go is what
			// marshalled into a date two millennia old.
			b, err := json.Marshal(ev)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if strings.Contains(string(b), "0001-01-01") {
				t.Errorf("%s notice on the wire carries Go's zero time: %s", name, b)
			}
		})
	}
}
