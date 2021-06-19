# WARNING! This project is experimental and you can damage your equipment!

I'm not responsible for any damage caused by a software error. If you don't know how to use this project correctly, don't use it or you will lose your parrot!

# Parrot Disco without SC2 only on LTE

I just want to have fun with Parrot Disco and I need something new :)

# Parrot Hardware & Software details

## C.H.U.C.K

-   Connecting to ZeroTier network on startup
-   Don't need to initialize WiFi to 4G reconnect, it's ready out of the box
-   Don't need to modify software (but we will probably need to do this if we want to start flight plan instead of auto landing on connection lost - we want to land precisely using flight plan with linear landing, I don't know if it possible)
-   `ARStream2` is streaming FROM disco to SC2. You need to initialize the stream. Default video ports `55004` and `55005` are CLOSED on Disco! You can't connect to them.
-   Discover port `44444` used to sending controller name, id and stream ports
-   Control UDP port `54321` (used to receive control actions from SC2)

## SkyController 2

-   Control UDP port `43210` or `9988` (used to receive events from disco)
-   Triggering video stream on `:7711/video`
-   ADB available on port `9050`

## FreeFlight Pro Android App

-   We can modify it using `APK Easy Tool` and edit some code in `Smali`

# WWW as SC2 details

-   Video feed using proxy server (with ffmpeg) using webrtc.
-   Control using proxy server with webrtc.
-   Live map with Disco and all flight parameters

# Roadmap

-   :heavy_check_mark: Gather all possible information in this repository to know if it will be possible at all.
-   :heavy_check_mark: Learn how to receive all parameters (battery, altitude, etc.)
-   :heavy_check_mark: Create website that will display all the needed informations and could control the API
-   :heavy_check_mark: If possible (due to weather) make test flight with starting flight plan from www and test video stream & camera control latency
-   :heavy_check_mark: Modify website as needed (component size, arrangement, etc.)
-   :heavy_check_mark: Make another test flight with flight plan
-   :heavy_check_mark: Add the rest of the functionality under control (mainly stick control, the throttle is unnecessary at this stage)
-   :heavy_check_mark: Make first manual test flight
-   :heavy_check_mark: Connect some gamepad for better control
-   Make another manual flight to test gamepad
-   Create new dashboard for better view and arrangement
-   TBA...
