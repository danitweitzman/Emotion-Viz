let globalBlobs = [];
let particles = [];
let distanceJoints = [];
let hashGrid;
let effectiveVertexDistance;

const maxVertexCount = 2000;
const substeps = 10;
const maxRadius = 0.25;
const minRadius = 0.1;
const vertexDistance = 0.015;
const marginX = 20;
const marginY = 20;
const outlineOnly = false;
const showCollisionAreas = false;

let selectedBlob = null;
let blobOffsetX = 0;
let blobOffsetY = 0;

const colorLowValence = "#2D6C84";
const colorHighValence = "#D1A256";

function setup() {
    const canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent("sketchContainer");
    textAlign(CENTER, CENTER);
    textSize(16);
    noStroke();
    textFont("GT Flexa Mono Trial VF");
    colorMode(HSB, 360, 100, 100, 100);
    frameRate(60);

    effectiveVertexDistance = vertexDistance * min(width, height);
    hashGrid = new HashGrid(
        width,
        height,
        Math.floor(effectiveVertexDistance * 2),
    );

    document.getElementById("clearEmotions").addEventListener(
        "click",
        clearEmotions,
    );

    fetchAllEmotions();
}

function draw() {
    background(255);

    const dt = 1 / 60;
    const sdt = dt / substeps;

    for (let i = particles.length; i--;) {
        particles[i].updateClient();
    }

    for (let substep = substeps; substep--;) {
        for (let i = globalBlobs.length; i--;) {
            const blob = globalBlobs[i];
            blob.currentArea = geometry.polygonArea(blob.particles);
            blob.areaDiff = (blob.area - blob.currentArea) / blob.area;
        }

        for (let i = particles.length; i--;) {
            const particle = particles[i];
            if (!selectedBlob || particle.parent !== selectedBlob) {
                particle.addForce(0, 1000 * sdt, 0);
            }

            const v = geometry.limit(
                { x: particle.vx, y: particle.vy },
                effectiveVertexDistance / sdt * 2,
            );
            particle.vx = v.x;
            particle.vy = v.y;
            particle.update(sdt);
        }

        for (let i = particles.length; i--;) {
            const v = particles[i];
            const v0 = v.prevSibling;
            const v1 = v.nextSibling;
            const lineNormal = geometry.getLineNormal(v0.x, v0.y, v1.x, v1.y);
            const dir = v.parent.areaDiff;
            v.move(lineNormal.x * dir, lineNormal.y * dir, 0);
        }

        for (let i = distanceJoints.length; i--;) {
            distanceJoints[i].update(1);
        }

        for (let i = particles.length; i--;) {
            const particle = particles[i];
            hashGrid
                .query(particle.x, particle.y, particle.radius)
                .forEach((other) => {
                    if (
                        other === particle ||
                        other === particle.nextSibling ||
                        other === particle.prevSibling
                    ) return;

                    const force = particle.testCollision(
                        other.x,
                        other.y,
                        other.radius,
                    );
                    if (force) {
                        particle.move(force.x * 0.5, force.y * 0.5);
                        other.move(-force.x * 0.5, -force.y * 0.5);
                    }
                });
        }

        for (let i = particles.length; i--;) {
            const particle = particles[i];
            particle.constrain(
                marginX,
                marginY,
                width - marginX,
                height - marginY,
            );
            particle.endUpdate(sdt);
        }
    }

    for (let i = 0; i < globalBlobs.length; i++) {
        drawBlob(globalBlobs[i]);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
    effectiveVertexDistance = vertexDistance * min(width, height);
}

function generateBlob(offsetX, offsetY, radius, c, emotionText, mass) {
    const numPoints = Math.floor((radius * PI * 2) / effectiveVertexDistance);
    const vertices = new Array(numPoints).fill(0).map((_, i, { length }) => {
        const t = i / length;
        const angle = t * TWO_PI;
        const particle = new ChainableParticle({
            x: Math.cos(angle) * radius + offsetX,
            y: Math.sin(angle) * radius + offsetY,
            z: 0,
            damping: 1,
            friction: 0.1,
            radius: effectiveVertexDistance,
            mass: mass, // Heavier mass for high arousal
        });
        particle.setClient(hashGrid.createClient(particle));
        return particle;
    });

    vertices.forEach((v, i, { length }) => {
        const vprev = vertices[(i + length - 1) % length];
        const vnext = vertices[(i + 1) % length];

        v.setPrevSibling(vprev);
        v.setNextSibling(vnext);

        if (i === 0) {
            v.setIsRoot(true);
        }
    });

    const joints = vertices
        .map((v) => {
            const v2 = v.nextSibling.nextSibling;
            return [
                new DistanceJoint(
                    v,
                    v.nextSibling,
                    effectiveVertexDistance,
                    0.75,
                ),
                new DistanceJoint(v, v2, effectiveVertexDistance * 2, 0.25),
            ];
        })
        .flat();

    const area = geometry.polygonArea(vertices) * random(0.6, 0.9);
    const blob = {
        area,
        currentArea: area,
        areaDiff: 0,
        rootParticle: vertices[0],
        particles: vertices,
        joints,
        radius,
        color: c,
        emotion: emotionText,
    };

    blob.particles.forEach((particle) => {
        particle.parent = blob;
    });

    return blob;
}

function drawBlob(blob) {
    if (outlineOnly) {
        stroke(blob.color);
        noFill();
        strokeWeight(1);
    } else {
        let c = color(blob.color);
        stroke(c);
        strokeWeight(effectiveVertexDistance * 2 - 6);
        fill(c);
    }

    beginShape();
    let currentParticle = blob.rootParticle;
    do {
        curveVertex(currentParticle.x, currentParticle.y);
        currentParticle = currentParticle.nextSibling;
    } while (currentParticle !== blob.rootParticle);
    curveVertex(blob.rootParticle.x, blob.rootParticle.y);
    let nextNext = blob.rootParticle.nextSibling.nextSibling;
    curveVertex(nextNext.x, nextNext.y);
    endShape();

    if (isBlobHovered(blob)) {
        const { cx, cy } = getBlobCenter(blob);
        fill(0);
        noStroke();
        text(blob.emotion, cx, cy - blob.radius - 10);
    }
}

function isBlobHovered(blob) {
    const polygon = blob.particles.map((p) => ({ x: p.x, y: p.y }));
    return pointInPolygon(mouseX, mouseY, polygon);
}

function getBlobCenter(blob) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let p of blob.particles) {
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
    }
    let cx = (minx + maxx) / 2;
    let cy = (miny + maxy) / 2;
    return { cx, cy };
}

async function fetchAllEmotions() {
    try {
        const response = await fetch("/emotions");
        if (!response.ok) throw new Error("Failed to fetch emotions.");
        const data = await response.json();
        console.log("All emotions from server on load:", data.emotions);

        for (let emotion of data.emotions) {
            createBlobForEmotion(emotion);
        }
    } catch (error) {
        console.error("Error fetching all emotions:", error);
    }
}

async function fetchAndDisplayEmotions() {
    try {
        const journalInput = document.getElementById("journalInput").value;
        console.log("Sending journal input to server:", journalInput);

        const response = await fetch("/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ journal: journalInput }),
        });

        if (!response.ok) throw new Error("Failed to submit emotion.");

        const data = await response.json();
        console.log("Data received from server:", data);

        const newEmotion = data.emotion;
        console.log("Extracted new emotion from response:", newEmotion);

        if (newEmotion) {
            createBlobForEmotion(newEmotion);
        }
    } catch (error) {
        console.error(error);
    }
}

function createBlobForEmotion(emotion) {
    const factor = map(emotion.valence, 1, 10, 0, 1);
    const blobHexColor = interpolateHexColor(
        colorLowValence,
        colorHighValence,
        factor,
    );

    const index = globalBlobs.length;
    const cols = 5;
    const spacing = 100;
    const startX = width / 2;
    const startY = height / 2;
    const col = index % cols;
    const row = floor(index / cols);

    const blobX = startX + (col - 2) * spacing;
    const blobY = startY + (row - 2) * spacing;

    const radius = map(emotion.arousal, 1, 10, 40, 120);

    const mass = map(emotion.arousal, 1, 10, 1, 20);

    const blob = generateBlob(
        blobX,
        blobY,
        radius,
        blobHexColor,
        emotion.emotion,
        mass,
    );

    globalBlobs.push(blob);
    particles.push(...blob.particles);
    distanceJoints.push(...blob.joints);
}

async function clearEmotions() {
    try {
        const response = await fetch("/clear", { method: "POST" });
        if (!response.ok) throw new Error("Failed to clear emotions.");

        globalBlobs = [];
        particles = [];
        distanceJoints = [];
        redraw();
    } catch (error) {
        console.error("Error clearing emotions:", error);
    }
}

document.getElementById("journalForm").addEventListener("submit", (e) => {
    e.preventDefault();
    fetchAndDisplayEmotions();
});

function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
            (px < ((xj - xi) * (py - yi) / (yj - yi) + xi));
        if (intersect) inside = !inside;
    }
    return inside;
}

function mousePressed() {
    for (let blob of globalBlobs) {
        if (isBlobHovered(blob)) {
            selectedBlob = blob;
            const { cx, cy } = getBlobCenter(blob);
            blobOffsetX = cx - mouseX;
            blobOffsetY = cy - mouseY;
            break;
        }
    }
}

function mouseDragged() {
    if (selectedBlob) {
        const { cx, cy } = getBlobCenter(selectedBlob);
        const targetX = mouseX + blobOffsetX;
        const targetY = mouseY + blobOffsetY;
        const dx = targetX - cx;
        const dy = targetY - cy;

        for (let p of selectedBlob.particles) {
            p.x += dx;
            p.y += dy;
        }
    }
}

function mouseReleased() {
    selectedBlob = null;
}

// Color interpolation helpers
function map(value, low1, high1, low2, high2) {
    return low2 + ((value - low1) * (high2 - low2)) / (high1 - low1);
}

function interpolateHexColor(color1, color2, factor) {
    const [r1, g1, b1] = hexToRgb(color1);
    const [r2, g2, b2] = hexToRgb(color2);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return rgbToHex(r, g, b);
}

function hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function rgbToHex(r, g, b) {
    return `#${
        ((1 << 24) + (r << 16) + (g << 8) + b)
            .toString(16)
            .slice(1)
            .toUpperCase()
    }`;
}

document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector("h1");
    const today = new Date();
    const options = { month: "long", day: "numeric", year: "numeric" };
    header.innerText = today.toLocaleDateString(undefined, options);
});
