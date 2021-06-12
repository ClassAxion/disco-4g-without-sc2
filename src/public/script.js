let peer,
    mode = 0,
    isAuthorized = false;

const socket = io({ autoConnect: false, reconnection: false });

const mainButton = $('button[data-action="button"][data-property="main"]');

function setCameraOrientation(x, y) {
    peer.send(JSON.stringify({ action: 'camera', data: { x, y } }));
}

$('#cameraX, #cameraY').on('change', function () {
    const x = $('#cameraX').val();
    const y = $('#cameraY').val();

    peer.send(JSON.stringify({ action: 'camera', data: { x, y } }));
});

$('input[type=range]').on('input', function () {
    $(this).trigger('change');
});

function connect() {
    socket.connect();

    socket.on('connect', function () {
        $(mainButton).text('Connected');

        mode = 1;
    });

    socket.on('disconnect', function () {
        $(mainButton).text('Disconnected');
        $(mainButton).attr('disabled', true);
        $('input').attr('disabled', true);

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

                    $('input').attr('disabled', false);
                } else if (packet.action === 'ping') {
                    peer.send(
                        JSON.stringify({
                            action: 'pong',
                            data: packet.data,
                        }),
                    );
                } else if (packet.action === 'battery') {
                    $('*[data-action="battery"][data-property="percent"]').text(packet.data.percent);
                } else if (packet.action === 'gps') {
                    $('*[data-action="gps"][data-property="isFixed"]').css(
                        'color',
                        packet.data.isFixed ? 'green' : 'red',
                    );
                } else if (packet.action === 'latency') {
                    $('*[data-action="connection"][data-property="latency"]').text(packet.data);
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
