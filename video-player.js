export class VideoPlayer {
    constructor() {
        this.video = document.getElementById('fullscreenVideo');
        this.container = document.getElementById('fullscreen');
    }

    play(url) {
        this.video.src = url;
        this.container.classList.add('show');
        this.video.play();
    }

    close() {
        this.container.classList.remove('show');
        this.video.pause();
        this.video.src = '';
    }
}