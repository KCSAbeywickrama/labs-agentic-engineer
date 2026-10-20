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

package execution

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wso2/aep/aep-api/internal/contracts/taskmeta"
	"github.com/wso2/aep/aep-api/internal/delivery"
)

// A coding Task's work is in its run's cycles, and nothing writes execution
// rows for it any more: its log stream ends at once instead of holding a
// console on "Attaching…" forever. A provision gate is the one Task whose row
// may still be on its way, so its stream waits for it.

type fixedSnapshot struct{ snap TaskSnapshot }

func (f fixedSnapshot) TaskSnapshot(context.Context, string, string, int) (*TaskSnapshot, error) {
	s := f.snap
	return &s, nil
}

type fixedExecs struct {
	rows []delivery.Execution
	err  error
}

func (f fixedExecs) ByIssue(context.Context, string, string, int) ([]delivery.Execution, error) {
	return f.rows, f.err
}

type lockedBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func openTask(kind string) *TaskSnapshot {
	return &TaskSnapshot{JSON: []byte(`{"issueNumber":7}`), DerivedStatus: delivery.DerivedStatusPending, Kind: kind}
}

// streamFor runs one connection for an open Task of kind over execs and
// returns what it wrote within the window, and whether it returned.
func streamFor(t *testing.T, kind string, execs ExecutionHistory, window time.Duration) (string, bool) {
	t.Helper()
	first := openTask(kind)
	svc := NewTaskStreamService(nil, fixedSnapshot{snap: *first}, execs, nil, delivery.NewTaskStreamHub())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	buf := &lockedBuffer{}
	done := make(chan struct{})
	go func() {
		svc.run(ctx, buf, func() {}, "acme", "shop", "acme/shop", 7, first)
		close(done)
	}()
	select {
	case <-done:
		return buf.String(), true
	case <-time.After(window):
		cancel()
		<-done
		return buf.String(), false
	}
}

func TestTaskStream_CodingTaskWithNoExecutionsEndsAtOnce(t *testing.T) {
	for _, kind := range []string{delivery.KindDevelopment, delivery.KindBug, delivery.KindConflict, delivery.KindValidation, ""} {
		t.Run("kind="+kind, func(t *testing.T) {
			out, ended := streamFor(t, kind, fixedExecs{}, time.Second)
			if !ended {
				t.Fatalf("the stream stayed open for a Task with no log of its own\n---\n%s", out)
			}
			if !strings.Contains(out, `"type":"task"`) || !strings.Contains(out, `"type":"done"`) || !strings.HasSuffix(out, "data: [DONE]\n\n") {
				t.Fatalf("want the task frame, then done and [DONE]\n---\n%s", out)
			}
		})
	}
}

func TestTaskStream_ProvisionTaskWaitsForItsExecution(t *testing.T) {
	out, ended := streamFor(t, delivery.KindProvision, fixedExecs{}, 50*time.Millisecond)
	if ended || strings.Contains(out, "[DONE]") {
		t.Fatalf("a provision gate whose row is not admitted yet must keep its stream\n---\n%s", out)
	}
}

// A read that FAILED says nothing about whether rows exist, so it never ends
// the stream as "no log of its own".
func TestTaskStream_ExecutionReadFailureDoesNotEndACodingTask(t *testing.T) {
	out, ended := streamFor(t, delivery.KindDevelopment, fixedExecs{err: errors.New("db: down")}, 50*time.Millisecond)
	if ended || strings.Contains(out, "[DONE]") {
		t.Fatalf("a failed read ended the stream\n---\n%s", out)
	}
}

// A coding Task with rows from before the run model still streams them, and
// holds while one is running.
func TestTaskStream_CodingTaskWithARunningExecutionStaysOpen(t *testing.T) {
	rows := []delivery.Execution{{ID: "e1", Kind: "coding", Status: string(taskmeta.ExecRunning), CreatedAt: time.Now()}}
	out, ended := streamFor(t, delivery.KindDevelopment, fixedExecs{rows: rows}, 50*time.Millisecond)
	if ended || strings.Contains(out, "[DONE]") {
		t.Fatalf("a Task with a running execution ended its stream\n---\n%s", out)
	}
	if !strings.Contains(out, `"type":"execution"`) {
		t.Fatalf("the execution frame is missing\n---\n%s", out)
	}
}
