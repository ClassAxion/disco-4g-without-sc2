# Parrot Disco without SC2 only on LTE

I just want to have fun with Parrot Disco and I need something new :) This project is open source.

# Parrot Hardware & Software details

## C.H.U.C.K

-   Connecting to ZeroTier network on startup
-   Don't need to initialize WiFi to 4G reconnect, it's ready out of the box
-   Don't need to modify software (but we will probably need to do this if we want to start flight plan instead of auto landing on connection lost - we want to land precisely using flight plan with linear landing, I don't know if it possible)
-   `ARStream2` available at RTP port `55004` or `5004`?, video RTCP port `55005` or `5005`?
-   We don't know how to trigger the stream without calling SC2
-   Control port UDP? `54321` or `44444`?

## SkyController 2

-   Control? port `43210`
-   Triggering video stream on `:7711/video`. We Need to check what's happening on this endpoint.
-   ADB available on port `9050`

## FreeFlight Pro Android App

-   We can modify it using `APK Easy Tool` and edit some code in `Snail`

# TODO

-   Record and check network traffic using `WireGuard` on network with SC2 and C.H.U.C.K.

# WWW as SC2 details

-   Client must be in ZeroZier network
-   Video feed directly from Disco (if is will be possible), without proxy server
-   Control without proxy server (if is will be possible) directly to Disco using `TCP/UDP` raw sockets in JavaScript API
-   Live map with Disco and all flight parameters
-   If directly connections won't be possible, then use webrtc `P2P` connection for control and video

# Roadmap

1. Gather all possible information in this repository to know if it will be possible at all.
2. Test Disco controlling using API (of course not in flight). Focus on how to take off with flight plan and how to move camera
3. Learn how to receive all parameters (battery, altitude, etc.)
4. Create website that will display all the needed informations and could control the API
5. If possible (due to weather) make test flight with starting flight plan from www and tilt the camera
6. Trigger video stream and try to watch it from VLC
7. Connect video feed on the website
8. If possible (due to weather) make test flight with starting flight plan from www and test video stream & camera control latency
9. Add the rest of the functionality under control (mainly stick control, the throttle is unnecessary at this stage)
10. TBA...
