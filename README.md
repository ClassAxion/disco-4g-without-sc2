# Tutorial is available here - https://www.youtube.com/watch?v=TXAllkr67v0

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
-   Parrot Disco ID `090e`

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
-   :heavy_check_mark: Make another manual flight to test gamepad
-   :heavy_check_mark: Create new dashboard for better view and arrangement
-   TBA...

# TODO IN 2023

-   :heavy_check_mark: Add icon on top navbar for camera settings, show modal with settings on click
-   Automatic camera exposure relative to sun function
-   Show modal on click on gamepad icon
-   Add permissions icon on top navbar, show modal on click
-   :heavy_check_mark: Add autonomous icon on top navbar, show modal on click
-   Create view for VR (with some parameters overlay if possible)
-   Connect SkyAware to show other planes with low AGL on the map (on dashboard and global map)
-   Add table on global map to show parrots parameters
-   :heavy_check_mark: Create disco auto following autonomous function
-   Create camera automatic pointing to other disco
-   Implement "Click on map and fly to this point" function
-   Create "no fly" zones (cities, etc)
-   Create blackbox to save all parameters during flight (csv file with timestamp)
-   Create software to read blackbox files
-   :heavy_check_mark: Automatic circular landing cancelling on connection recovery
-   Add flightplan icon on top navbar with flightplan modal on click
-   Create flightplan controller for creating flightplans and running it
-   Automatic checking for "landing" flightplan during first connect
-   :heavy_check_mark: Add settings icon on top navbar, show modal with global settings on click

# Useful links

-   https://developer.parrot.com/docs/mavlink-flightplan/messages_v1.html
-   https://developer.parrot.com/docs/mavlink-flightplan/overview.html
-   https://mavlink.io/en/messages/common.html#mav_commands
-   https://mavlink.io/en/file_formats/#mission_plain_text_file
-   https://github.com/mavlink/mavlink/blob/master/message_definitions/v1.0/common.xml
-   https://ardupilot.org/copter/docs/common-mavlink-mission-command-messages-mav_cmd.html#mav-cmd-nav-waypoint
-   https://github.com/Parrot-Developers/libARMavlink/blob/master/Sources/ARMAVLINK_MissionItemUtils.c
-   https://developer.parrot.com/docs/olympe/arsdkng_ardrone3_piloting.html#olympe.enums.ardrone3.Piloting.MoveTo_Orientation_mode
-   https://github.com/Parrot-Developers/arsdk-xml/blob/master/xml/ardrone3.xml
-   https://github.com/gazebosim/gazebo-classic
-   https://github.com/Parrot-Developers/firmwared
-   https://bebop-autonomy.readthedocs.io/en/latest/
-   https://github.com/AutonomyLab/bebop_autonomy
-   https://github.com/jeremyfix/docker/tree/master/headless-nvidia-parrot-sphinx-host-displays
-   https://forum.developer.parrot.com/t/running-sphinx-inside-docker-container/9058/13
-   https://web.archive.org/web/20180707103759/http://developer.parrot.com/docs/sphinx/installation.html
-   https://gist.github.com/jeremyfix/929a68e990c6cccc4074ed0259db551c
