// Package gpu resolves device allocation status for DRA-managed pods.
package gpu

import (
	"context"
	"errors"
	"fmt"
)

// ErrNodeNotFound is returned when a node has no inventory yet.
var ErrNodeNotFound = errors.New("node not found")

// DeviceInfo describes a single GPU exposed to a pod.
type DeviceInfo struct {
	Name   string
	Driver string
	UUID   string
	Shared bool
}

// StatusController reconciles GPU claims against node inventory.
type StatusController struct {
	nodes map[string][]DeviceInfo
}

func (c *StatusController) getGPUStatus(info DeviceInfo, node string) (string, error) {
	devices, ok := c.nodes[node]
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrNodeNotFound, node)
	}
	for _, d := range devices {
		if d.UUID == info.UUID {
			if d.Shared {
				return "shared", nil
			}
			return "allocated", nil
		}
	}
	return "pending", nil
}

// Count returns how many devices a node exposes.
func (c *StatusController) Count(node string) int {
	return len(c.nodes[node])
}

func (c *StatusController) Reconcile(ctx context.Context, node string) error {
	_, err := c.getGPUStatus(DeviceInfo{}, node)
	return err
}
