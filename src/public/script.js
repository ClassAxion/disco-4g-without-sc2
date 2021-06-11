const socket = io();

let peer;

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

            if (packet.action === 'ping') {
                peer.send(
                    JSON.stringify({
                        action: 'pong',
                        data: packet.data,
                    }),
                );
            } else if (packet.action === 'battery') {
                $('*[data-action="battery"][data-property="percent"]').text(packet.data.percent);
            } else if (packet.action === 'gps') {
                $('*[data-action="gps"][data-property="isFixed"]').css('color', packet.data.isFixed ? 'green' : 'red');
            } else if (packet.action === 'latency') {
                $('*[data-action="connection"][data-property="latency"]').text(packet.data);
            } else if (packet.action === 'altitude') {
                $('*[data-action="altitude"][data-property="meters"]').text(Number(packet.data.toFixed(1)));
            }
        });
    }

    peer.signal(data);
});
