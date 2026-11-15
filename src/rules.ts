/**
 * Built-in diagnostic rules. Each one names a problem with its numbers and gives one practical
 * fix. Limits come from the device profile (see budgets.ts) or are common rules of thumb.
 */

import type { DiagnosticRule } from './diagnostics.js';
import { formatBytes, formatCount, formatMs } from './format.js';

const ms = (v: number): string => `${formatMs(v)} ms`;
const MB = 1048576;

export const FRAME_RULES: readonly DiagnosticRule[] = [
  {
    id: 'gpu-bound',
    title: 'GPU-bound',
    check: ({ gpu, cpu, budget }) => (gpu !== null && gpu > budget * 0.9 && (cpu === null || gpu > cpu * 1.3)
      ? { message: `GPU ${ms(gpu)} for a ${ms(budget)} budget.`, advice: 'Lower the pixel ratio, shadow map sizes or overdraw (transparent layers, full-screen passes) first.' }
      : null)
  },
  {
    id: 'cpu-bound',
    title: 'CPU-bound',
    check: ({ cpu, gpu, budget }) => (cpu !== null && cpu > budget * 0.9 && (gpu === null || cpu > gpu * 1.3)
      ? { message: `CPU ${ms(cpu)} for a ${ms(budget)} budget.`, advice: 'Split the frame with stats.mark() to find the slow part; fewer draw calls and objects cut submission time.' }
      : null)
  },
  {
    id: 'no-headroom',
    title: 'No headroom',
    check: ({ cpu, gpu, budget }) => {
      const worst = Math.max(cpu ?? 0, gpu ?? 0);
      if (worst <= budget * 0.85) return null;
      if (worst <= budget * 0.9) return { message: `The busiest side uses ${Math.round((worst / budget) * 100)}% of the frame budget.`, advice: 'Any spike will drop a frame: keep 15% free for GC, uploads and input.' };
      // Past 90% one side usually dominates (gpu-bound, cpu-bound); when neither does, both are the problem.
      if (cpu === null || gpu === null || cpu > gpu * 1.3 || gpu > cpu * 1.3) return null;
      return { message: `CPU ${ms(cpu)} and GPU ${ms(gpu)}: both near or over the ${ms(budget)} budget.`, advice: 'Cutting one side will not be enough: reduce draw calls (CPU) and pixels or shading cost (GPU) together.' };
    }
  },
  {
    id: 'stutter',
    title: 'Stutter',
    check: ({ p95, budget, jitter }) => (p95 !== null && p95 > budget * 1.25
      ? { message: `P95 frame ${ms(p95)}${jitter === null ? '' : `, jitter ${ms(jitter)}`}.`, advice: 'Look for regular yellow columns in the frame graph: a periodic job (GC, uploads, physics steps) is the usual cause.' }
      : null)
  },
  {
    id: 'jitter',
    title: 'Uneven frames',
    check: ({ jitter, p95, budget }) => (jitter !== null && jitter > 2 && (p95 === null || p95 <= budget * 1.25)
      ? { message: `Frame intervals vary by ${ms(jitter)} (σ).`, advice: 'Average FPS looks fine but motion is uneven: check garbage collection and long tasks.' }
      : null)
  },
  {
    id: 'long-tasks',
    title: 'Long tasks',
    check: ({ blocking }) => (blocking !== null && blocking > 50
      ? { message: `${Math.round(blocking)} ms per second blocked by long animation frames.`, advice: 'Work outside the render loop (layout, third-party scripts, big JSON parses) is stealing frames.' }
      : null)
  },
  {
    id: 'shader-compiles',
    title: 'Shaders compiled while running',
    check: ({ recentPrograms }) => (recentPrograms > 0
      ? { message: `${recentPrograms} new shader program${recentPrograms > 1 ? 's' : ''} in the last 10 s.`, advice: 'Each compile can freeze a frame: warm up with renderer.compileAsync(scene, camera) before showing new materials.' }
      : null)
  },
  {
    id: 'gc-pressure',
    title: 'Allocations every frame',
    check: ({ gcRate }) => (gcRate !== null && gcRate >= 0.5
      ? { message: `${gcRate.toFixed(1)} garbage collections per second.`, advice: 'Reuse Vector3, Matrix4 and arrays instead of creating them in the loop.' }
      : null)
  },
  {
    id: 'geometry-leak',
    title: 'Geometries keep growing',
    check: ({ geometryGrowth }) => (geometryGrowth !== null && geometryGrowth >= 20
      ? { message: `+${geometryGrowth} geometries in 30 s, never fewer.`, advice: 'Call geometry.dispose() when a mesh is removed for good.' }
      : null)
  },
  {
    id: 'texture-leak',
    title: 'Textures keep growing',
    check: ({ textureGrowth }) => (textureGrowth !== null && textureGrowth >= 10
      ? { message: `+${textureGrowth} textures in 30 s, never fewer.`, advice: 'Call texture.dispose() (and dispose render targets) when they are no longer used.' }
      : null)
  },
  {
    id: 'draw-calls',
    title: 'Too many draw calls',
    check: ({ calls, budgets, profile }) => (calls > budgets.calls
      ? { message: `${formatCount(calls)} draw calls, ${profile} budget ${formatCount(budgets.calls)}.`, advice: 'Merge static meshes, use InstancedMesh or BatchedMesh for repeated objects, share materials.' }
      : null)
  },
  {
    id: 'triangles',
    title: 'Too many triangles',
    check: ({ triangles, budgets, profile }) => (triangles > budgets.triangles
      ? { message: `${formatCount(triangles)} triangles, ${profile} budget ${formatCount(budgets.triangles)}.`, advice: 'Add LOD levels for distant objects, decimate dense meshes, cull what is off screen.' }
      : null)
  },
  {
    id: 'small-draws',
    title: 'Small draw calls',
    check: ({ calls, triangles, lines, points }) => (calls >= 50 && (triangles + lines + points) / calls < 100
      ? { message: `${Math.round(triangles / calls)} triangles per draw call on average.`, advice: 'The CPU cost is per draw, not per triangle: merge or instance small meshes.' }
      : null)
  },
  {
    id: 'passes',
    title: 'Many render passes',
    check: ({ passes }) => (passes !== null && passes > 4
      ? { message: `${passes} render passes per frame.`, advice: 'Each pass re-submits a scene or a full-screen quad: combine post effects, skip passes that do not change.' }
      : null)
  },
  {
    id: 'pixel-ratio',
    title: 'High pixel ratio',
    check: ({ pixelRatio, budgets, bufferPixels, displayPixels }) => {
      if (pixelRatio !== null && pixelRatio > budgets.pixelRatio) {
        return { message: `Pixel ratio ${pixelRatio.toFixed(2)} (limit ${budgets.pixelRatio}).`, advice: 'renderer.setPixelRatio(Math.min(devicePixelRatio, 2)): beyond 2 the extra pixels are rarely visible and cost fill rate.' };
      }

      return displayPixels > 0 && bufferPixels > displayPixels * 1.1
        ? { message: `The drawing buffer has ${Math.round((bufferPixels / displayPixels) * 100)}% of the pixels it is shown on.`, advice: 'Rendering more pixels than the display shows wastes GPU time: match the buffer to the canvas size × devicePixelRatio.' }
        : null;
    }
  },
  {
    id: 'context-lost',
    title: 'Context lost',
    check: ({ contextLost }) => (contextLost > 0
      ? { message: `The WebGL context was lost ${contextLost} time${contextLost > 1 ? 's' : ''}.`, advice: 'Usually too much GPU memory or a driver reset: reduce texture sizes and handle webglcontextrestored.' }
      : null)
  }
];

export const SCENE_RULES: readonly DiagnosticRule[] = [
  {
    id: 'texture-memory',
    title: 'Heavy textures',
    scope: 'scene',
    check: ({ scene, budgets }) => (scene !== null && scene.textureBytes > budgets.textureMB * MB
      ? { message: `About ${formatBytes(scene.textureBytes)} of uncompressed textures (budget ${budgets.textureMB} MB).`, advice: 'Use KTX2 / Basis compressed textures and smaller sizes for distant or small surfaces.' }
      : null)
  },
  {
    id: 'large-textures',
    title: 'Large uncompressed textures',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.largeUncompressed > 0
      ? { message: `${scene.largeUncompressed} texture${scene.largeUncompressed > 1 ? 's' : ''} of 2048 px or more, uncompressed.`, advice: 'Compress them with KTX2 (about 4–8× smaller in GPU memory) or halve their size.' }
      : null)
  },
  {
    id: 'missing-mips',
    title: 'Textures without mipmaps',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.missingMips > 0
      ? { message: `${scene.missingMips} texture${scene.missingMips > 1 ? 's' : ''} sample mipmaps they do not have.`, advice: 'Enable generateMipmaps or set minFilter to LinearFilter: missing mips cause shimmering and slow sampling.' }
      : null)
  },
  {
    id: 'program-variants',
    title: 'Shader variant explosion',
    scope: 'scene',
    check: ({ scene, programs }) => (scene !== null && programs !== null && scene.materials > 0 && programs > scene.materials * 1.5 && programs > 8
      ? { message: `${programs} shader programs for ${scene.materials} materials.`, advice: 'Different defines, fog, lights or shadow settings per object create variants: unify material settings.' }
      : null)
  },
  {
    id: 'lights',
    title: 'Many dynamic lights',
    scope: 'scene',
    check: ({ scene, budgets, profile }) => (scene !== null && scene.lights > budgets.lights
      ? { message: `${scene.lights} lights, ${profile} budget ${budgets.lights}.`, advice: 'Every fragment loops over every light: bake static lighting into lightmaps or an environment map.' }
      : null)
  },
  {
    id: 'shadows',
    title: 'Expensive shadows',
    scope: 'scene',
    check: ({ scene, budgets, shadowMapEnabled }) => {
      // castShadow does nothing while the renderer's shadow maps are off.
      if (scene === null || shadowMapEnabled === false) return null;
      if (scene.shadowLights > budgets.shadowLights) {
        return { message: `${scene.shadowLights} shadow-casting lights (budget ${budgets.shadowLights}).`, advice: 'Each one renders the scene again: keep one sun shadow, fake the rest, or set shadow.autoUpdate = false when static.' };
      }

      if (scene.pointShadows > 0) return { message: `${scene.pointShadows} point light${scene.pointShadows > 1 ? 's' : ''} with shadows: 6 renders each.`, advice: 'Use a spot light, or bake the shadow.' };
      return scene.largestShadowMap > budgets.shadowMapSize
        ? { message: `A ${scene.largestShadowMap} px shadow map (budget ${budgets.shadowMapSize}).`, advice: 'Lower shadow.mapSize and tighten the shadow camera around the visible area instead.' }
        : null;
    }
  },
  {
    id: 'overdraw',
    title: 'Overdraw risk',
    scope: 'scene',
    check: ({ scene }) => {
      if (scene === null) return null;
      if (scene.transparent > 50) return { message: `${scene.transparent} transparent materials.`, advice: 'Transparent layers are shaded once per layer and sorted every frame: use alphaTest for cut-outs.' };
      return scene.transparentDepthWrite > 0
        ? { message: `${scene.transparentDepthWrite} transparent material${scene.transparentDepthWrite > 1 ? 's' : ''} with depthWrite on.`, advice: 'Set depthWrite = false on transparent materials to avoid sorting artefacts.' }
        : null;
    }
  },
  {
    id: 'instancing',
    title: 'Instancing candidates',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.instancingGroups > 0
      ? { message: `${scene.instancingGroups} group${scene.instancingGroups > 1 ? 's' : ''} of 10+ meshes share geometry and material (largest: ${scene.largestInstancingGroup}).`, advice: 'Turn each group into one InstancedMesh: one draw call instead of one per copy.' }
      : null)
  },
  {
    id: 'culling-off',
    title: 'Culling disabled',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.frustumCulledOff > 20
      ? { message: `${scene.frustumCulledOff} meshes with frustumCulled = false.`, advice: 'They are drawn even off screen: fix their bounding spheres instead of disabling culling.' }
      : null)
  },
  {
    id: 'static-matrices',
    title: 'Static objects update matrices',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.matrixAutoUpdate > 1000
      ? { message: `${formatCount(scene.matrixAutoUpdate)} objects recompute their matrix every frame.`, advice: 'Set matrixAutoUpdate = false on objects that never move and call updateMatrix() once.' }
      : null)
  },
  {
    id: 'batched-fill',
    title: 'Oversized BatchedMesh',
    scope: 'scene',
    check: ({ scene }) => (scene !== null && scene.batchedFill !== null && scene.batchedFill < 0.5
      ? { message: `A BatchedMesh uses ${Math.round(scene.batchedFill * 100)}% of its instance capacity.`, advice: 'Allocate closer to what you need: unused capacity still costs GPU memory.' }
      : null)
  },
  {
    id: 'bones',
    title: 'Heavy skeletons',
    scope: 'scene',
    check: ({ scene, profile }) => (scene !== null && profile === 'mobile' && scene.maxBones > 64
      ? { message: `A skeleton with ${scene.maxBones} bones.`, advice: 'On mobile keep skeletons under 64 bones: simplify the rig or bake secondary motion.' }
      : null)
  }
];
