import { Component, ElementRef, Input, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

@Component({
  selector: 'app-talking-character',
  template: `<div #canvasWrapper class="canvas-container"></div>`,
  styles: [`
    .canvas-container {
      width: 100%;
      height: 100%;
      min-height: 480px;
      background: radial-gradient(circle at 50% 35%, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 70%, rgba(9, 13, 22, 1) 100%);
      border-radius: 16px;
      overflow: hidden;
      position: relative;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3), inset 0 1px 1px 0 rgba(255, 255, 255, 0.1);
    }
  `]
})
export class TalkingCharacterComponent implements AfterViewInit, OnDestroy {
  // The live volume passed down from the AgentService via AppComponent
  @Input() audioVolume: number = 0;

  @ViewChild('canvasWrapper', { static: true }) canvasWrapper!: ElementRef<HTMLDivElement>;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private headMesh: THREE.Mesh | null = null;
  private headNode: THREE.Object3D | null = null;
  private mouthOpenIndex: number = -1;
  private animationFrameId: number = 0;
  private timer = new THREE.Timer();

  // Initial head transforms
  private initialHeadRotation = new THREE.Euler();
  private initialHeadPosition = new THREE.Vector3();

  // Eye Saccades (Darting) State
  private targetLookX = 0;
  private targetLookY = 0;
  private currentLookX = 0;
  private currentLookY = 0;
  private nextSaccadeTime = 0;

  // Eye Blinking State
  private isBlinking = false;
  private blinkStartTime = 0;
  private blinkDuration = 0.16; // seconds
  private nextBlinkTime = 0;
  private currentBlinkWeight = 0;

  // Head Motion & Speech State
  private currentHeadPitch = 0;
  private currentHeadYaw = 0;
  private currentHeadRoll = 0;
  private speechHeadImpulse = 0;
  private previousVolume = 0;

  private resizeObserver?: ResizeObserver;

  ngAfterViewInit() {
    this.initThreeJs();
    this.loadModel();
    this.animate();
  }

  private initThreeJs() {
    const container = this.canvasWrapper.nativeElement;

    // 1. Scene & Camera Setup
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 2.5);
    this.camera.lookAt(0, 0, 0);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(1, 2, 5);
    this.scene.add(directionalLight);

    // 3. Renderer Setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // 4. Handle Container Resizing
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
  }

  private onResize() {
    if (!this.renderer || !this.camera || !this.canvasWrapper) return;
    const container = this.canvasWrapper.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width > 0 && height > 0) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  private loadModel() {
    const ktx2Loader = new KTX2Loader()
      .setTranscoderPath('https://unpkg.com/three/examples/jsm/libs/basis/')
      .detectSupport(this.renderer);

    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    loader.load('facecap.glb', (gltf) => {
      const model = gltf.scene;

      this.scene.add(model);

      // Search for head node and face mesh
      model.traverse((node: any) => {
        if (node.name && node.name.toLowerCase() === 'head') {
          this.headNode = node;
        }

        if (node.isMesh && node.morphTargetInfluences && node.morphTargetDictionary) {
          this.headMesh = node;
          const dict = node.morphTargetDictionary;
          if (dict) {
            this.mouthOpenIndex = dict['jawOpen'] ?? dict['mouthOpen'] ?? -1;
          }
        }
      });

      // Calculate Bounding Box of the Head Mesh / Model to center it perfectly
      const targetForBounds = this.headMesh || model;
      targetForBounds.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(targetForBounds);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Recenter model position so head center is exactly at (0, 0, 0)
      model.position.x = -center.x;
      model.position.y = -center.y;
      model.position.z = -center.z;

      // Adjust camera distance to frame the head comfortably in the view
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = this.camera.fov * (Math.PI / 180);
      let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.55;
      if (isNaN(cameraZ) || cameraZ < 1) cameraZ = 2.5;

      this.camera.position.set(0, 0, cameraZ);
      this.camera.lookAt(0, 0, 0);

      // Fallback: if no dedicated head bone was found, use the model scene
      if (!this.headNode) {
        this.headNode = model;
      }

      if (this.headNode) {
        this.initialHeadRotation.copy(this.headNode.rotation);
        this.initialHeadPosition.copy(this.headNode.position);
      }
    }, undefined, (error) => {
      console.error('Error loading 3D model:', error);
    });
  }

  private setMorphTarget(name: string, targetValue: number, lerpFactor: number = 0.2): void {
    if (!this.headMesh || !this.headMesh.morphTargetDictionary || !this.headMesh.morphTargetInfluences) return;
    const index = this.headMesh.morphTargetDictionary[name];
    if (index !== undefined) {
      const current = this.headMesh.morphTargetInfluences[index];
      this.headMesh.morphTargetInfluences[index] = current + (targetValue - current) * lerpFactor;
    }
  }

  private animate = (timestamp?: number) => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.timer.update(timestamp);
    const elapsedTime = this.timer.getElapsed();

    // --- 1. MOUTH & LIP SYNC ---
    if (this.headMesh && this.mouthOpenIndex !== -1 && this.headMesh.morphTargetInfluences) {
      const currentInfluence = this.headMesh.morphTargetInfluences[this.mouthOpenIndex];
      const targetInfluence = this.audioVolume;
      this.headMesh.morphTargetInfluences[this.mouthOpenIndex] = currentInfluence + (targetInfluence - currentInfluence) * 0.5;

      // Organic mouth shape variations when speaking
      this.setMorphTarget('mouthPucker', this.audioVolume * 0.2, 0.3);
      this.setMorphTarget('mouthFunnel', this.audioVolume * 0.15, 0.3);
    }

    // --- 2. EYE SACCADES (NATURAL LOOK AROUND) ---
    if (elapsedTime > this.nextSaccadeTime) {
      // 70% chance to look near center, 30% chance for a wider glance
      const glanceWider = Math.random() > 0.7;
      this.targetLookX = (Math.random() - 0.5) * (glanceWider ? 0.4 : 0.15);
      this.targetLookY = (Math.random() - 0.5) * (glanceWider ? 0.25 : 0.1);

      // Next look target in 1.5 to 4 seconds
      this.nextSaccadeTime = elapsedTime + 1.5 + Math.random() * 2.5;

      // Trigger a blink on larger eye movements
      if (glanceWider && Math.random() > 0.5 && !this.isBlinking) {
        this.isBlinking = true;
        this.blinkStartTime = elapsedTime;
      }
    }

    // Smoothly update eye position
    this.currentLookX += (this.targetLookX - this.currentLookX) * 0.25;
    this.currentLookY += (this.targetLookY - this.currentLookY) * 0.25;

    // Apply eye gaze blendshapes
    this.setMorphTarget('eyeLookOut_L', Math.max(0, this.currentLookX), 0.3);
    this.setMorphTarget('eyeLookIn_R', Math.max(0, this.currentLookX), 0.3);
    this.setMorphTarget('eyeLookIn_L', Math.max(0, -this.currentLookX), 0.3);
    this.setMorphTarget('eyeLookOut_R', Math.max(0, -this.currentLookX), 0.3);

    this.setMorphTarget('eyeLookUp_L', Math.max(0, this.currentLookY), 0.3);
    this.setMorphTarget('eyeLookUp_R', Math.max(0, this.currentLookY), 0.3);
    this.setMorphTarget('eyeLookDown_L', Math.max(0, -this.currentLookY), 0.3);
    this.setMorphTarget('eyeLookDown_R', Math.max(0, -this.currentLookY), 0.3);

    // --- 3. PROCEDURAL BLINKING ---
    if (elapsedTime > this.nextBlinkTime && !this.isBlinking) {
      this.isBlinking = true;
      this.blinkStartTime = elapsedTime;
      // Schedule next blink in 2.5 to 5.5 seconds
      this.nextBlinkTime = elapsedTime + 2.5 + Math.random() * 3.0;
    }

    if (this.isBlinking) {
      const progress = (elapsedTime - this.blinkStartTime) / this.blinkDuration;
      if (progress >= 1.0) {
        this.isBlinking = false;
        this.currentBlinkWeight = 0;
      } else if (progress < 0.35) {
        // Rapid closing phase
        this.currentBlinkWeight = progress / 0.35;
      } else {
        // Slightly slower opening phase
        this.currentBlinkWeight = 1.0 - (progress - 0.35) / 0.65;
      }
    } else {
      this.currentBlinkWeight = 0;
    }

    this.setMorphTarget('eyeBlink_L', this.currentBlinkWeight, 0.8);
    this.setMorphTarget('eyeBlink_R', this.currentBlinkWeight, 0.8);

    // --- 4. EYEBROWS & FACIAL EXPRESSIONS ---
    const browLift = this.audioVolume > 0.1 ? this.audioVolume * 0.35 : Math.sin(elapsedTime * 1.5) * 0.03;
    this.setMorphTarget('browInnerUp', Math.max(0, browLift), 0.2);
    this.setMorphTarget('browOuterUp_L', Math.max(0, browLift * 0.8), 0.2);
    this.setMorphTarget('browOuterUp_R', Math.max(0, browLift * 0.8), 0.2);

    // --- 5. NATURAL HEAD MOTION (IDLE SWAY + SPEECH REACTION + GAZE FOLLOW) ---
    // A. Idle Organic Breathing & Sway
    const pitchIdle = Math.sin(elapsedTime * 0.7) * 0.02 + Math.cos(elapsedTime * 1.2) * 0.01;
    const yawIdle = Math.sin(elapsedTime * 0.5) * 0.04 + Math.cos(elapsedTime * 0.9) * 0.02;
    const rollIdle = Math.sin(elapsedTime * 0.6) * 0.02;

    // B. Speech Reaction (Nods on volume changes)
    const volDelta = Math.max(0, this.audioVolume - this.previousVolume);
    this.previousVolume = this.audioVolume;
    this.speechHeadImpulse = THREE.MathUtils.lerp(
      this.speechHeadImpulse,
      volDelta * 0.6 + this.audioVolume * 0.04,
      0.15
    );

    // C. Gaze Follow (Head turns slightly in the direction eyes look)
    const gazeYaw = this.currentLookX * 0.15;
    const gazePitch = this.currentLookY * 0.1;

    // Combine targets
    const targetPitch = pitchIdle + (this.speechHeadImpulse * 0.5) - gazePitch;
    const targetYaw = yawIdle + gazeYaw;
    const targetRoll = rollIdle + (this.speechHeadImpulse * 0.2);

    // Smooth lerp to target head pose
    this.currentHeadPitch = THREE.MathUtils.lerp(this.currentHeadPitch, targetPitch, 0.1);
    this.currentHeadYaw = THREE.MathUtils.lerp(this.currentHeadYaw, targetYaw, 0.1);
    this.currentHeadRoll = THREE.MathUtils.lerp(this.currentHeadRoll, targetRoll, 0.1);

    // Apply rotation and breathing translation to head node
    if (this.headNode) {
      this.headNode.rotation.x = this.initialHeadRotation.x + this.currentHeadPitch;
      this.headNode.rotation.y = this.initialHeadRotation.y + this.currentHeadYaw;
      this.headNode.rotation.z = this.initialHeadRotation.z + this.currentHeadRoll;

      // Subtle breathing motion on Y axis
      this.headNode.position.y = this.initialHeadPosition.y + Math.sin(elapsedTime * 1.2) * 0.005;
    }

    // --- 6. RENDER ---
    this.renderer.render(this.scene, this.camera);
  };

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    cancelAnimationFrame(this.animationFrameId);
    if (this.timer) {
      this.timer.dispose();
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}