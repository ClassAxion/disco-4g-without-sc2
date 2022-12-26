#!/bin/bash
sudo ip link set wlxa0f3c1083c69 up
sudo iwconfig wlxa0f3c1083c69 essid DISCO-006402
sudo dhclient wlxa0f3c1083c69
