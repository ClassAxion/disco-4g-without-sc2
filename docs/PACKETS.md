# Server -> Client packets

## ping

```
{
    action: 'ping'
    data: {
        time: 0
    }
}
```

## authorize

```
{
    action: 'authorize'
}
```

## latency

```
{
    action: 'latency',
    data: 0
}
```

## health

```
{
    action: 'health',
    data: {
        status: 'OK',
        components: {
            homeType: 'TAKEOFF',
            magnetoCalibrationRequired: false,
            homeChosen: 'TAKEOFF',
            imuState: true,
            barometerState: true,
            ultrasoundState: true,
            gpsState: true,
            magnetometerState: true,
            verticalCameraState: true
        }
    }
}
```

## gps

```
{
    action: 'gps',
    data: {
        isFixed: true,
        satellites: 10,
        location: {
            lat: 0,
            lon: 0
        }
    }
}
```

## battery

```
{
    action: 'battery',
    data: {
        percent: 100,
        voltage: 11.4
    }
}
```

## speed (in m/s)

```
{
    action: 'speed',
    data: 0
}
```

## altitude (in meters)

```
{
    action: 'altitude',
    data: 0
}
```

## attitude (in degress)

```
{
    action: 'attitude',
    data: {
        pitch: 0,
        roll: 0,
        yaw: 0
    }
}
```

## state

```
{
    action: 'state',
    data: {
        flyingState: 0,
        canTakeOff: false,
        isConnected: true
    }
}
```

## camera

```
{
    action: 'camera',
    data: {
        maxSpeed: {
            tilt: 0,
            pan: 0
        },
        currentOrientation: {
            tilt: 0,
            pan: 0
        }
    }
}
```

# Client -> Server packets

## ping

```
{
    action: 'ping',
    data: 0
}
```

## camera

```
{
    action: 'camera',
    data: {
        type: 'speed',
        tilt: 0,
        pan: 0
    }
}
```

## piloting

```
{
    action: 'piloting',
    data: {
        pitch: 0,
        roll: 0
    }
}
```

## circle

```
{
    action: 'circle',
    data: 'CW'
}
```

## flightPlanStart

```
{
    action: 'flightPlanStart',
    data: {
        name: '',
        force: false
    }
}
```

## returnToHome

```
{
    action: 'returnToHome',
    data: 'start'
}
```

## takeOff

```
{
    action: 'takeOff'
}
```

## emergency

```
{
    action: 'emergency',
    data: {
        type: 'landingFlightPlan'
    }
}
```
