let peer,
    mode = 0,
    isAuthorized = false;

const socket = io({ autoConnect: false, reconnection: false });

const mainButton = $('button[data-action="button"][data-property="main"]');

function setCameraOrientation(x, y) {
    peer.send(JSON.stringify({ action: 'camera', data: { x, y } }));
}

$('#cameraTilt, #cameraPan').on('change', function () {
    const tilt = $('#cameraTilt').val();
    const pan = $('#cameraPan').val();

    peer.send(JSON.stringify({ action: 'camera', data: { type: 'absolute', tilt, pan } }));
});

$('#cameraTilt-degrees, #cameraPan-degrees').on('change', function () {
    const tilt = $('#cameraTilt-degrees').val();
    const pan = $('#cameraPan-degrees').val();

    peer.send(JSON.stringify({ action: 'camera', data: { type: 'degrees', tilt, pan } }));
});

$('input[type=range]').on('input', function () {
    $(this).trigger('change');
});

$('#cameraTilt-degrees, #cameraPan-degrees').on('mouseup', function () {
    $(this).val(0);
    $(this).trigger('change');
});

const controllerPosition = {
    lat: 53.34912,
    lon: 17.64003,
};

const map = L.map('map').setView([controllerPosition.lat, controllerPosition.lon], 15);

const drawFlightPlan = true;

if (drawFlightPlan) {
    const waypointTypes = {
        21: 'Linear landing',
        16: 'Waypoint',
        2500: 'Start',
    };

    $.get('/flightplans/test', ({ waypoints }) => {
        waypoints = waypoints.filter((waypoint) => waypoint.lat && waypoint.lon);

        for (const waypoint of waypoints) {
            const type = waypointTypes[waypoint.type];

            L.marker([waypoint.lat, waypoint.lon])
                .addTo(map)
                .bindPopup(`#${waypoint.index} ${type} ${waypoint.alt.toFixed(0)}M`);
        }

        L.polyline(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon])).addTo(map);
    });
}

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Parrot Disco Live Map',
}).addTo(map);

const controllerLatLng = L.latLng(controllerPosition.lat, controllerPosition.lon);

const controllerMarker = L.marker([controllerPosition.lat, controllerPosition.lon])
    .addTo(map)
    .bindPopup('Virtual controller location');

const discoIcon = L.icon({
    iconUrl: '/disco.png',
    iconSize: [64, 64],
});

const discoMarker = L.marker([controllerPosition.lat, controllerPosition.lon], { icon: discoIcon })
    .addTo(map)
    .bindPopup('Disco location');

function connect() {
    socket.connect();

    socket.on('connect', function () {
        $(mainButton).text('Connected');

        mode = 1;
    });

    socket.on('disconnect', function () {
        $(mainButton).text('Disconnected');
        $(mainButton).attr('disabled', true);
        $('*[data-authorize="true"]').attr('disabled', true);

        try {
            peer.destroy();
        } catch {}

        mode = -1;
    });

    socket.on('signal', function (data) {
        if (!peer) {
            peer = new SimplePeer();

            peer.on('connect', () => {
                console.log('Peer connected');
            });

            peer.on('signal', function (signal) {
                socket.emit('signal', signal);
            });

            peer.on('stream', (stream) => {
                const video = document.querySelector('video');

                if ('srcObject' in video) {
                    video.srcObject = stream;
                } else {
                    video.src = window.URL.createObjectURL(stream);
                }

                try {
                    video.play();
                } catch {}
            });

            peer.on('data', (data) => {
                const packet = JSON.parse(data.toString());

                console.log(packet);

                if (packet.action === 'authorize') {
                    isAuthorized = true;

                    $('*[data-authorize="true"]').attr('disabled', false);
                } else if (packet.action === 'ping') {
                    peer.send(
                        JSON.stringify({
                            action: 'pong',
                            data: packet.data,
                        }),
                    );
                } else if (packet.action === 'battery') {
                    const batteryPercent = packet.data.percent;

                    $('*[data-action="battery"][data-property="percent"]').text(batteryPercent);

                    $('*[data-action="battery"][data-property="percent"]').css(
                        'color',
                        batteryPercent > 30 ? 'green' : 'red',
                    );
                } else if (packet.action === 'gps') {
                    if (packet.data.isFixed !== undefined) {
                        $('*[data-action="gps"][data-property="isFixed"]').css(
                            'color',
                            packet.data.isFixed ? 'green' : 'red',
                        );
                    }

                    if (packet.data.satellites !== undefined) {
                        $('*[data-action="gps"][data-property="satellites"]').text(packet.data.satellites);
                    }

                    if (packet.data.location !== undefined) {
                        const { lat, lon } = packet.data.location;

                        const latLng = [lat, lon];

                        discoMarker.setLatLng(latLng);

                        const mapAutoFollow = $('#mapAutoFollow').is(':checked');

                        if (mapAutoFollow) {
                            map.panTo(latLng, {
                                animate: true,
                            });
                        }

                        const discoLatLng = L.latLng(lat, lon);

                        const distance = controllerLatLng.distanceTo(discoLatLng);

                        $('*[data-action="distance"][data-property="controller"]').text(distance.toFixed(0));

                        $('*[data-action="gps"][data-property="lat"]').text(lat.toFixed(5));
                        $('*[data-action="gps"][data-property="lon"]').text(lon.toFixed(5));
                    }
                } else if (packet.action === 'latency') {
                    const latency = packet.data;

                    $('*[data-action="connection"][data-property="latency"]').text(latency);

                    $('*[data-action="connection"][data-property="latency"]').css(
                        'color',
                        latency < 50 ? 'green' : 'red',
                    );
                } else if (packet.action === 'altitude') {
                    $('*[data-action="altitude"][data-property="meters"]').text(Number(packet.data.toFixed(1)));
                } else if (packet.action === 'canTakeOff') {
                    if (packet.data) {
                        $(mainButton).text('Take off');
                    } else {
                        $(mainButton).text("Can't take off");
                    }

                    if (isAuthorized) {
                        $(mainButton).attr('disabled', !packet.data);
                    }
                } else if (packet.action === 'flyingState') {
                    if (packet.data === 0) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Landed');
                    } else if (packet.data === 1) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Taking off');
                    } else if (packet.data === 2) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Hovering');
                    } else if (packet.data === 3) {
                        $('*[data-action="flyingState"][data-property="info"]').text('In flight');
                    } else if (packet.data === 4) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Landing');
                    } else if (packet.data === 5) {
                        $('*[data-action="flyingState"][data-property="info"]').text('Emergency');
                    }
                } else if (packet.action === 'event') {
                } else if (packet.action === 'speed') {
                    const ms = packet.data;
                    const kmh = ms * 3.6;

                    $('*[data-action="speed"][property="m/s"]').text(ms.toFixed(1));
                    $('*[data-action="speed"][property="km/h"]').text(kmh.toFixed(0));
                } else if (packet.action === 'camera') {
                    if (packet.data.maxSpeed !== undefined) {
                        const { maxTiltSpeed, maxPanSpeed } = packet.data.maxSpeed;

                        $('#cameraPan-degrees').attr('max', maxTiltSpeed);
                        $('#cameraPan-degrees').attr('min', maxTiltSpeed * -1);

                        $('#cameraTilt-degrees').attr('max', maxPanSpeed);
                        $('#cameraTilt-degrees').attr('min', maxPanSpeed * -1);
                    }

                    if (packet.data.currentSpeed !== undefined) {
                        const { tilt, pan } = packet.data.currentSpeed;

                        $('#cameraPan-degrees').val(pan);
                        $('#cameraTilt-degrees').val(tilt);
                    }

                    if (packet.data.orientation !== undefined) {
                        const { tilt, pan } = packet.data.orientation;

                        $('#cameraPan-current').val(pan);
                        $('#cameraTilt-current').val(tilt);
                    }
                }
            });
        }

        peer.signal(data);
    });
}

$(mainButton).on('click', function () {
    if (mode === 0) {
        $(mainButton).attr('disabled', true);
        $(mainButton).text('Connecting..');

        connect();
    } else if (mode === 1) {
        peer.send(JSON.stringify({ action: 'takeOff' }));
    }
});
