// --- 1. SYSTEM SETTINGS & PARAMETERS ---
const baseImages = [
    'images/anh1.jpg', 'images/anh2.jpg', 'images/anh3.jpg', 'images/anh4.jpg', 'images/anh5.jpg',
    'images/anh6.jpg', 'images/anh7.jpg', 'images/anh8.jpg', 'images/anh9.jpg', 'images/anh10.jpg'
];

const textLines = [
    "Chúc Mừng",
    "Ngày Quốc Tế Thiếu Nhi",
    "1 Tháng 6",
    "chúc các bé vui vẻ ",
    "mãi yêu <3"
];

let scene, camera, renderer, controls;
let particles, particleGeometry, particleMaterial;
let totalParticles = 45000; 
let currentStage = 0;       // 0: Hold, 1: Text, 2: Sphere, 3: Floating, 4: End

let holdProgress = 0;
let holdAnimationId = null;
let isHolding = false;

let loadedTextures = [];
let sphereImageGroup = new THREE.Group();
let floatingLettersGroup = new THREE.Group();

let targetPositions = new Float32Array(totalParticles * 3);
let particleCustomData = []; 

// Số lượng hạt tập trung dồn vào để nặn chữ
const textParticlesCount = 38000; 

let textCanvas, textCtx;
let textTimelineIndex = 0;
let textTimer = null;

const loadingManager = new THREE.LoadingManager();
const textureLoader = new THREE.TextureLoader(loadingManager);

loadingManager.onLoad = () => {
    setTimeout(() => {
        document.getElementById('loader').classList.add('hidden-element');
    }, 600);
};

// --- 2. OFFSCREEN CANVAS TO SCAN TEXT POINTS ---
function initTextCanvas() {
    textCanvas = document.createElement('canvas');
    textCanvas.width = 1600; 
    textCanvas.height = 800;
    textCtx = textCanvas.getContext('2d', { willReadFrequently: true });
}

// Hàm nặn chữ từ hạt: Chính diện nét căng, xoay nghiêng mỏng mịn không bị dày hạt
function getTextPositions(text) {
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    
    // Tăng size font chữ một chút để các nét chữ rõ ràng và tách biệt nhau tốt hơn
    textCtx.font = "bold 90px 'Dancing Script', 'Quicksand', sans-serif";
    textCtx.fillStyle = "#ffffff";
    textCtx.textAlign = "center";
    textCtx.textBaseline = "middle";
    textCtx.fillText(text, textCanvas.width / 2, textCanvas.height / 2);

    const imgData = textCtx.getImageData(0, 0, textCanvas.width, textCanvas.height).data;
    const rawPoints = [];

    // Quét điểm với bước nhảy khít để lấy chính xác khung sườn chữ
    for (let y = 0; y < textCanvas.height; y += 2) {
        for (let x = 0; x < textCanvas.width; x += 2) {
            const alpha = imgData[(y * textCanvas.width + x) * 4 + 3];
            if (alpha > 150) { // Lọc kỹ chỉ lấy lõi của nét chữ
                rawPoints.push({
                    x: (x - textCanvas.width / 2) * 0.022,
                    y: -(y - textCanvas.height / 2) * 0.022
                });
            }
        }
    }

    const points = [];
    if (rawPoints.length === 0) return points;

    // Giảm bớt số lượng hạt trực tiếp tham gia tạo chữ để nhìn nghiêng không bị dày đặc
    const activeTextParticles = Math.min(22000, textParticlesCount);

    for (let i = 0; i < textParticlesCount; i++) {
        if (i < activeTextParticles) {
            const pt = rawPoints[i % rawPoints.length];
            
            // ÉP CHẶT TRỤC Z: Chỉ cho phép hạt lệch cực kỳ mỏng để khi xoay nghiêng chữ không bị dày đặc hạt
            const zDepth = (Math.random() - 0.5) * 0.4; 

            // GIẢM BIÊN ĐỘ LOANG: Hạt bám sát sườn chữ, không bay lung tung làm mất form chữ
            const jitterX = (Math.random() - 0.5) * 0.04;
            const jitterY = (Math.random() - 0.5) * 0.04;

            points.push({
                x: pt.x + jitterX,
                y: pt.y + jitterY,
                z: zDepth
            });
        } else {
            // Số hạt dư thừa còn lại sẽ dạt hẳn ra làm sao nền lơ lửng lưa thưa ở xa, không chen chúc vào chữ
            const seedRadius = 35 + Math.random() * 40;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos((Math.random() * 2) - 1);
            
            points.push({
                x: seedRadius * Math.sin(phi) * Math.cos(theta),
                y: seedRadius * Math.sin(phi) * Math.sin(theta),
                z: (Math.random() - 0.5) * 20
            });
        }
    }
    return points;
}

// --- 3. INITIALIZE THREE.JS GRAPHICS ---
function init() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
    camera.position.set(0, 0, 28); 

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    initTextCanvas();

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 160;
    controls.minDistance = 2; 

    scene.add(sphereImageGroup);
    scene.add(floatingLettersGroup);

    setupVolumeParticles();

    for (let i = 0; i < 64; i++) {
        loadedTextures.push(textureLoader.load(baseImages[i % baseImages.length]));
    }

    window.addEventListener('resize', onWindowResize);
    animate();
}

// --- 4. ADVANCED PARTICLE SETUP (HỒNG SEN CHUẨN DEARGIFT) ---
function setupVolumeParticles() {
    particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(totalParticles * 3);
    const colors = new Float32Array(totalParticles * 3);

    // Bảng màu hồng sen phối hồng pastel ngọt ngào, không bị lóa trắng
    const palette = [
        new THREE.Color('#e0115f'), // Hồng sen đậm
        new THREE.Color('#ff4d80'), // Hồng neon dịu
        new THREE.Color('#ff85a2'), // Hồng đào pastel
        new THREE.Color('#ffb3c1'), // Hồng nhạt lãng mạn
        new THREE.Color('#ffa64d')  // Cam nhạt ấm áp bổ trợ hiệu ứng lấp lánh
    ];

    for (let i = 0; i < totalParticles; i++) {
        // Trạng thái ban đầu: Vũ trụ lơ lửng rộng khắp không gian
        const r = Math.pow(Math.random(), 0.5) * 85; 
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        targetPositions[i * 3] = positions[i * 3];
        targetPositions[i * 3 + 1] = positions[i * 3 + 1];
        targetPositions[i * 3 + 2] = positions[i * 3 + 2];

        // Gán màu ngẫu nhiên từ palette
        const pickedColor = palette[Math.floor(Math.random() * palette.length)];
        colors[i * 3] = pickedColor.r;
        colors[i * 3 + 1] = pickedColor.g;
        colors[i * 3 + 2] = pickedColor.b;

        particleCustomData.push({
            speedFactor: 0.3 + Math.random() * 0.7,
            phase: Math.random() * Math.PI * 2
        });
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Tạo kết cấu hạt mịn, mượt mà không bị gai góc
    const pCanvas = document.createElement('canvas');
    pCanvas.width = 64; pCanvas.height = 64;
    const pCtx = pCanvas.getContext('2d');
    const grad = pCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.6, 'rgba(240,240,240,0.2)');
    grad.addColorStop(1, 'rgba(240,240,240,0)');
    pCtx.fillStyle = grad;
    pCtx.fillRect(0, 0, 64, 64);

    particleMaterial = new THREE.PointsMaterial({
        size: 0.28, 
        map: new THREE.CanvasTexture(pCanvas),
        transparent: true,
        opacity: 0.9,
        vertexColors: true, 
        blending: THREE.NormalBlending, 
        depthWrite: false
    });

    particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
}

// --- 5. HOLD TO START EVENT CONTROL ---
function onHoldStart() {
    if (currentStage !== 0) return;
    isHolding = true;
    document.getElementById('bg-music').play().catch(()=>{});
    animateRingProgress();
}

function onHoldEnd() {
    if (currentStage !== 0) return;
    isHolding = false;
    cancelAnimationFrame(holdAnimationId);
    holdProgress = 0;
    setRingOffset(326.72);
    resetHạtVềVũTrụ();
}

function setRingOffset(offset) {
    const ring = document.getElementById('hold-progress');
    if (ring) ring.style.strokeDashoffset = offset;
}

function animateRingProgress() {
    if (!isHolding) return;
    holdProgress += 1.5; 
    if (holdProgress > 100) holdProgress = 100;

    const offset = 326.72 - (holdProgress / 100) * 326.72;
    setRingOffset(offset);

    if (holdProgress >= 100) {
        isHolding = false;
        cancelAnimationFrame(holdAnimationId);
        startTextPresentation(); 
        return;
    }
    holdAnimationId = requestAnimationFrame(animateRingProgress);
}

// --- 6. MÀN TRÌNH DIỄN CHỮ HẠT CHUYỂN ĐỘNG LINH HOẠT (STAGE 1) ---
function startTextPresentation() {
    currentStage = 1;
    document.getElementById('hold-container').classList.add('hidden-element');
    textTimelineIndex = 0;
    showNextTextLine();
}

function showNextTextLine() {
    if (textTimelineIndex < textLines.length) {
        const points = getTextPositions(textLines[textTimelineIndex]);
        
        for (let i = 0; i < totalParticles; i++) {
            if (i < points.length) {
                // Nhóm hạt chính bay vào tụ thành chữ (Mặt trước khít, mặt sau lưa thưa)
                targetPositions[i * 3] = points[i].x;
                targetPositions[i * 3 + 1] = points[i].y;
                targetPositions[i * 3 + 2] = points[i].z;
            } else {
                // Các hạt thừa dạt ra ngoài làm sao nền bao quát, tăng độ sâu không gian vũ trụ
                const seedRadius = 28 + Math.random() * 50; 
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos((Math.random() * 2) - 1);
                
                targetPositions[i * 3] = seedRadius * Math.sin(phi) * Math.cos(theta);
                targetPositions[i * 3 + 1] = seedRadius * Math.sin(phi) * Math.sin(theta);
                targetPositions[i * 3 + 2] = (Math.random() - 0.5) * 40; 
            }
        }
        textTimelineIndex++;
        textTimer = setTimeout(showNextTextLine, 5000); 
    } else {
        bùngNổHạtPhépMàu();
    }
}

function resetHạtVềVũTrụ() {
    for (let i = 0; i < totalParticles; i++) {
        const r = Math.pow(Math.random(), 0.6) * 90;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        targetPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        targetPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        targetPositions[i * 3 + 2] = r * Math.cos(phi);
    }
}

// --- 7. TRANSITION EFFECT & QUẢ CẦU ẢNH (STAGE 2 & 3) ---
function bùngNổHạtPhépMàu() {
    for (let i = 0; i < totalParticles * 3; i++) {
        targetPositions[i] *= 2.5; 
    }

    setTimeout(() => {
        currentStage = 2;
        dựngQuảCầuẢnhXếpKhítSongSong();
        document.getElementById('next-stage-btn').classList.remove('hidden-element');
    }, 800);
}

function goToNextStage() {
    if (currentStage === 2) {
        currentStage = 3;
        camera.position.set(0, 0, 50);
        
        while(sphereImageGroup.children.length > 0){ 
            sphereImageGroup.remove(sphereImageGroup.children[0]); 
        }
        dựngThưLơLửngKhôngTrung();
    } else if (currentStage === 3) {
        currentStage = 4;
        document.getElementById('next-stage-btn').classList.add('hidden-element');
        document.getElementById('mini-letter-btn').classList.remove('hidden-element');
        resetHạtVềVũTrụ();
    }
}

function dựngQuảCầuẢnhXếpKhítSongSong() {
    const radius = 16; 

    for (let i = 0; i < totalParticles; i++) {
        const r = 26 + Math.random() * 55; 
        const theta_p = Math.random() * Math.PI * 2;
        const phi_p = Math.acos((Math.random() * 2) - 1);
        targetPositions[i * 3] = r * Math.sin(phi_p) * Math.cos(theta_p);
        targetPositions[i * 3 + 1] = r * Math.sin(phi_p) * Math.sin(theta_p);
        targetPositions[i * 3 + 2] = r * Math.cos(phi_p);
    }

    const rings = 6;      
    const sectors = 10;   
    let imgIdx = 0;

    for (let r = 1; r <= rings; r++) {
        const phi = (Math.PI * r) / (rings + 1);

        for (let s = 0; s < sectors; s++) {
            if (imgIdx >= loadedTextures.length) break;

            const theta = (Math.PI * 2 * s) / sectors;

            const geo = new THREE.PlaneGeometry(6.2, 4.4); 
            const mat = new THREE.MeshBasicMaterial({ 
                map: loadedTextures[imgIdx], 
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.98
            });
            const mesh = new THREE.Mesh(geo, mat);

            mesh.position.set(
                radius * Math.sin(phi) * Math.cos(theta),
                radius * Math.cos(phi),
                radius * Math.sin(phi) * Math.sin(theta)
            );

            mesh.lookAt(mesh.position.clone().multiplyScalar(2));
            
            sphereImageGroup.add(mesh);
            imgIdx++;
        }
    }
}

function dựngThưLơLửngKhôngTrung() {
    resetHạtVềVũTrụ();

    loadedTextures.forEach((tex, idx) => {
        const geo = new THREE.PlaneGeometry(6, 4.5);
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set(
            (Math.random() - 0.5) * 60,
            (Math.random() - 0.5) * 40,
            (Math.random() - 0.5) * 40
        );
        mesh.rotation.set(Math.random() * 0.4, Math.random() * 0.4, Math.random() * 0.2);
        
        mesh.userData = {
            speedY: 0.005 + Math.random() * 0.01,
            rotSpeed: 0.002 + Math.random() * 0.003,
            seed: Math.random() * 100
        };

        floatingLettersGroup.add(mesh);
    });
}

// --- 8. TYPEWRITER EFFECT LETTER OVERLAY ---
function openCentralLetter() {
    document.getElementById('mini-letter-btn').classList.add('hidden-element');
    document.getElementById('letter-overlay').classList.remove('hidden-element');

    const fullMessage = "Chào người con gái anh yêu! 🌸\n\nHôm nay là một ngày vô cùng ý nghĩa và đặc biệt. Món quà nhỏ bé lấp lánh này là cả một bầu trời hạt ánh sáng mà anh tự tay cấu trúc và code nên để dành tặng riêng cho em.\n\nChúc em luôn luôn giữ trọn nét cười rạng rỡ, xinh đẹp, bình an và luôn hạnh phúc khi ở bên cạnh anh nhé. Cảm ơn em vì đã đến bên đời anh. Mãi yêu em! 💕";
    
    const textContainer = document.getElementById('typewriter-text');
    textContainer.innerText = "";
    
    let index = 0;
    function typeEffect() {
        if (index < fullMessage.length) {
            textContainer.innerHTML += fullMessage.charAt(index) === "\n" ? "<br>" : fullMessage.charAt(index);
            index++;
            setTimeout(typeEffect, 45); 
        } else {
            document.getElementById('final-love-photo').classList.remove('hidden-opacity');
            document.getElementById('final-love-photo').classList.add('show-opacity');
        }
    }
    setTimeout(typeEffect, 400);
}

function closeLetter() {
    document.getElementById('letter-overlay').classList.add('hidden-element');
    while(floatingLettersGroup.children.length > 0){ 
        floatingLettersGroup.remove(floatingLettersGroup.children[0]); 
    }
    
    currentStage = 0;
    holdProgress = 0;
    setRingOffset(326.72);
    resetHạtVềVũTrụ();
    document.getElementById('hold-container').classList.remove('hidden-element');
}

// --- 9. ANIMATION RENDERING LOOP ---
function animate() {
    requestAnimationFrame(animate);

    const positions = particleGeometry.attributes.position.array;
    const time = Date.now() * 0.001;

    for (let i = 0; i < totalParticles; i++) {
        // Nội suy mượt mà đưa hạt di chuyển linh hoạt từ chữ này sang chữ khác
        positions[i * 3]     += (targetPositions[i * 3]     - positions[i * 3])     * 0.06;
        positions[i * 3 + 1] += (targetPositions[i * 3 + 1] - positions[i * 3 + 1]) * 0.06;
        positions[i * 3 + 2] += (targetPositions[i * 3 + 2] - positions[i * 3 + 2]) * 0.06;

        // Thêm hiệu ứng gợn sóng lơ lửng nhẹ nhàng cho form chữ sinh động
        if (currentStage === 1 && i < textParticlesCount) {
            const data = particleCustomData[i];
            positions[i * 3 + 2] += Math.sin(time * data.speedFactor * 1.5 + data.phase) * 0.008;
            positions[i * 3 + 1] += Math.cos(time * data.speedFactor * 0.7 + data.phase) * 0.003;
        }
    }
    particleGeometry.attributes.position.needsUpdate = true;

    // Xoay nhẹ hệ thống hạt để kiểm tra góc nhìn thanh đậm 3D nghệ thuật
    if (currentStage === 1) {
        particles.rotation.y = Math.sin(time * 0.15) * 0.15; // Lắc nhẹ sang hai bên để khoe góc nghiêng rải rác thần thánh
    } else if (currentStage === 2) {
        sphereImageGroup.rotation.y += 0.002;
        particles.rotation.y += 0.0004; 
    } else if (currentStage === 3) {
        particles.rotation.y += 0.0003;
        floatingLettersGroup.children.forEach(mesh => {
            const data = mesh.userData;
            mesh.position.y += Math.sin(Date.now() * 0.001 + data.seed) * 0.015;
            mesh.rotation.y += data.rotSpeed;
        });
    } else {
        particles.rotation.y += 0.0003;
    }

    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.onload = () => {
    init();
    window.onHoldStart = onHoldStart;
    window.onHoldEnd = onHoldEnd;
    window.goToNextStage = goToNextStage;
    window.openCentralLetter = openCentralLetter;
    window.closeLetter = closeLetter;
};