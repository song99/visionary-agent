import { Component, ElementRef, OnInit, ViewChild, OnDestroy, AfterViewInit } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `
    <div class="avatar-container" #rendererContainer>
      <!-- The 3D Canvas will be injected here -->
    </div>
  `,
  styles: [`
    .avatar-container {
      width: 100%;
      height: 500px;
      background-color: #f0f4f8; /* Soft background for the VerityLens UI */
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  `]
})
export class AvatarComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rendererContainer', { static: true }) rendererContainer!: ElementRef;

  // Three.js Core
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private clock = new THREE.Clock();
  private animationFrameId: number = 0;

  // Avatar Rigging
  private headBone?: THREE.Object3D;
  private faceMesh?: THREE.SkinnedMesh;

  // Eye Saccade State
  private targetLookLeft = 0;
  private targetLookRight = 0;
  private targetLookUp = 0;
  private targetLookDown = 0;
  private nextSaccadeTime = 0;

  ngOnInit(): void {
    this.initScene();
    this.loadModel();
  }

  ngAfterViewInit(): void {
    this.startAnimationLoop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationFrameId);
    this.renderer.dispose();
  }

  private initScene(): void {
    // 1. Setup Renderer
    this.renderer.setSize(this.rendererContainer.nativeElement.clientWidth, 500);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.rendererContainer.nativeElement.appendChild(this.renderer.domElement);

    // 2. Setup Camera (Positioned to look at the face)
    this.camera.position.set(0, 1.5, 3);
    this.camera.lookAt(0, 1.5, 0);

    // 3. Setup Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(2, 2, 5);
    this.scene.add(directionalLight);
  }

  private loadModel(): void {
    const loader = new GLTFLoader();

    // Assumes your file is in src/assets/facecap.glb
    loader.load('assets/facecap.glb', (gltf: GLTF) => {
      this.scene.add(gltf.scene);

      // Center the model slightly down if needed
      gltf.scene.position.y = -0.5;

      // Traverse the model to find the Head bone and Face mesh
      gltf.scene.traverse((node: any) => {
        // Find Head Bone
        if (node.isBone && node.name.toLowerCase().includes('head')) {
          this.headBone = node;
        }

        // Find Face Mesh with ARKit Blendshapes
        if (node.isMesh && node.morphTargetDictionary) {
          if ('eyeLookUpLeft' in node.morphTargetDictionary) {
            this.faceMesh = node as THREE.SkinnedMesh;
          }
        }
      });

      console.log('Avatar loaded successfully.');
    }, undefined, (error) => {
      console.error('Error loading facecap.glb:', error);
    });
  }

  private startAnimationLoop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.startAnimationLoop);
    const time = this.clock.getElapsedTime();

    // --- 1. HEAD SWAY ---
    if (this.headBone) {
      this.headBone.rotation.y = Math.sin(time * 0.5) * 0.05; // Look left/right
      this.headBone.rotation.x = Math.sin(time * 0.3) * 0.03; // Look up/down
    }

    // --- 2. EYE DARTING (SACCADES) ---
    if (this.faceMesh && this.faceMesh.morphTargetInfluences && this.faceMesh.morphTargetDictionary) {
      const dict = this.faceMesh.morphTargetDictionary;
      const influences = this.faceMesh.morphTargetInfluences;

      // Pick a new random look target every few seconds
      if (time > this.nextSaccadeTime) {
        this.targetLookLeft = Math.random() > 0.5 ? Math.random() * 0.4 : 0;
        this.targetLookRight = this.targetLookLeft === 0 ? Math.random() * 0.4 : 0;
        this.targetLookUp = Math.random() > 0.5 ? Math.random() * 0.3 : 0;
        this.targetLookDown = this.targetLookUp === 0 ? Math.random() * 0.3 : 0;

        // Next movement in 1 to 3 seconds
        this.nextSaccadeTime = time + 1.0 + (Math.random() * 2.0);
      }

      const lerpSpeed = 0.15;

      // Helper function to safely apply lerp
      const applyLerp = (shapeName: string, targetValue: number) => {
        if (shapeName in dict) {
          const index = dict[shapeName];
          influences[index] = THREE.MathUtils.lerp(influences[index], targetValue, lerpSpeed);
        }
      };

      // Apply ARKit Blendshapes
      applyLerp('eyeLookInLeft', this.targetLookRight);
      applyLerp('eyeLookOutLeft', this.targetLookLeft);
      applyLerp('eyeLookInRight', this.targetLookLeft);
      applyLerp('eyeLookOutRight', this.targetLookRight);

      applyLerp('eyeLookUpLeft', this.targetLookUp);
      applyLerp('eyeLookUpRight', this.targetLookUp);
      applyLerp('eyeLookDownLeft', this.targetLookDown);
      applyLerp('eyeLookDownRight', this.targetLookDown);
    }

    // --- 3. RENDER ---
    this.renderer.render(this.scene, this.camera);
  };
}