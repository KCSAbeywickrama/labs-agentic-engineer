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

package issues

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/wso2/aep/aep-api/internal/platform/mcprpc"
)

// The Issues agent's classify_report: what kind of report a user's message
// is, asked of the platform's classifier (Jev) with the platform's key, which
// stays in aep-api; the pod reaches it through this tool on its Issues route.
// Every failure — no classifier, the classifier failing, the org past its
// rate — answers kind "unknown", so the agent asks the user instead of filing
// and the turn never fails on it.

// ReportClassifier classifies one report for org. It returns an error, never
// a partial class, when it cannot.
type ReportClassifier interface {
	ClassifyReport(ctx context.Context, org string, r Report) (ReportClass, error)
}

// Report is the user's message and their earlier ones, oldest first. The
// classifier cuts it to its own caps before it leaves aep-api.
type Report struct {
	Message string
	Recent  []string
}

// ReportClass is classify_report's answer.
type ReportClass struct {
	Kind         string       `json:"kind"`
	Confidence   float64      `json:"confidence"`
	Alternatives []KindChance `json:"alternatives"`
}

// KindChance is one kind with its probability.
type KindChance struct {
	Kind string  `json:"kind"`
	P    float64 `json:"p"`
}

// unknownReportClass is the answer of every failure.
var unknownReportClass = ReportClass{Kind: "unknown", Alternatives: []KindChance{}}

// Each org may classify ClassifyBurst reports at once and one every
// classifyEvery after that, per replica: a chat classifies once per report,
// so this bounds only a runaway (or abusive) pod spending the platform's key.
const (
	ClassifyBurst = 10
	classifyEvery = 2 * time.Second
)

// classifyLimiter is a token bucket per org.
type classifyLimiter struct {
	mu   sync.Mutex
	orgs map[string]*rate.Limiter
}

func newClassifyLimiter() *classifyLimiter {
	return &classifyLimiter{orgs: map[string]*rate.Limiter{}}
}

func (l *classifyLimiter) allow(org string) bool {
	l.mu.Lock()
	lim, ok := l.orgs[org]
	if !ok {
		lim = rate.NewLimiter(rate.Every(classifyEvery), ClassifyBurst)
		l.orgs[org] = lim
	}
	l.mu.Unlock()
	return lim.Allow()
}

// classifyReport answers classify_report for org. The report's text is
// never logged.
func classifyReport(w http.ResponseWriter, r *http.Request, id []byte, c ReportClassifier, limits *classifyLimiter, org string, args userToolArgs) {
	if strings.TrimSpace(args.Message) == "" {
		mcprpc.WriteToolError(w, id, "message is required: the user's message, verbatim")
		return
	}
	class := unknownReportClass
	switch {
	case c == nil:
		// No Jev key on this install: the agent asks.
	case !limits.allow(org):
		slog.WarnContext(r.Context(), "issues agent: classify_report rate-limited", "org", org)
	default:
		got, err := c.ClassifyReport(r.Context(), org, Report{Message: args.Message, Recent: args.RecentMessages})
		if err != nil {
			slog.WarnContext(r.Context(), "issues agent: could not classify the report", "org", org, "error", err)
			break
		}
		if got.Alternatives == nil {
			got.Alternatives = []KindChance{}
		}
		class = got
	}
	mcprpc.WriteToolText(w, id, mcprpc.MustJSON(class))
}
