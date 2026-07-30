// Package gpu resolves device allocation status for DRA-managed pods.
package gpu

import (
	"context"
	"fmt"
)

// DeviceInfo describes a single GPU exposed to a pod.
type DeviceInfo struct {
	Name   string
	Driver string
	UUID   string
}

// StatusController reconciles GPU claims against node inventory.
type StatusController struct {
	nodes map[string][]DeviceInfo
}

func (c *StatusController) getGPUStatus(info DeviceInfo, node string) (string, error) {
	devices, ok := c.nodes[node]
	if !ok {
		return "", fmt.Errorf("node %q not found", node)
	}
	for _, d := range devices {
		if d.UUID == info.UUID {
			return "allocated", nil
		}
	}
	return "pending", nil
}

func (c *StatusController) Reconcile(ctx context.Context, node string) error {
	_, err := c.getGPUStatus(DeviceInfo{}, node)
	return err
}
