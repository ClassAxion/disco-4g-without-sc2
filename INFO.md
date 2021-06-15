# Enable video feed with SC2 on WiFi

1. Turn on disco and SC2
2. Connect your PC to Disco WiFi
3. Open FF pro app to initialize video feed
4. Open `http://192.168.42.1:7711/video` in `VLC`
5. Open `stream.sdp` in `VLC`

Remember to turn off your firewall!

# Enable video feed with SC2 on LTE

1. Turn on disco and SC2
2. Switch SC2 from WiFi to LTE
3. Open FF pro app to initialize video feed (it can take a while on LTE)
4. Download `http://SC2_IP:7711/video` to `stream.sdp`
5. Replace `192.168.X.1` IP in `stream.sdp` to your Disco ZeroTier IP.
6. Open `video.sdp` in `VLC`

Remember to turn off your firewall!
