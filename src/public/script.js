const socket = io();

let peer;

function setCameraOrientation(x, y) {
    peer.send(JSON.stringify({ action: "camera", data: { x, y } }));
}

$("#cameraX, #cameraY").on("change", function () {
    const x = $("#cameraX").val();
    const y = $("#cameraY").val();

    peer.send(JSON.stringify({ action: "camera", data: { x, y } }));
});

$("input[type=range]").on("input", function () {
    $(this).trigger("change");
});

socket.on("signal", function (data) {
    if (!peer) {
        peer = new SimplePeer();

        peer.on("connect", () => {
            console.log("Peer connected");

            const text = Math.random().toString(36);

            setInterval(
                () => peer.send(JSON.stringify({ action: "ping", data: text })),
                5000
            );
        });

        peer.on("signal", function (signal) {
            socket.emit("signal", signal);
        });

        peer.on("stream", (stream) => {
            const video = document.querySelector("video");

            if ("srcObject" in video) {
                video.srcObject = stream;
            } else {
                video.src = window.URL.createObjectURL(stream);
            }

            try {
                video.play();
            } catch {}
        });
    }

    peer.signal(data);
});
