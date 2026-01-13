export interface WebglFrame {
  data: Uint8Array
  size: number
  timestamp: number
  metrics?: {
    drawMs: number
    readPixelsMs: number
    totalMs: number
  }
}

export interface WebglRenderer {
  render: (timeMs: number) => WebglFrame | null
  resize: (size: number) => void
  dispose: () => void
}

const mark = (_label: string) => { void _label }
const measure = (_name: string, _start: string, _end: string) => { void _name; void _start; void _end }

const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now()

const vertexSource = `#version 300 es
precision highp float;
out vec2 vUV;
const vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  vec2 p = positions[gl_VertexID];
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`

const fragmentSource = `#version 300 es
precision highp float;

out vec4 outColor;
in vec2 vUV;

uniform float uTime;
uniform vec2 uResolution;

mat3 rotationX(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}

mat3 rotationY(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float sceneSDF(vec3 p, float t) {
  float twistK = 1.35 * sin(t * 0.6);
  float angle = twistK * p.y;
  float s = sin(angle);
  float c = cos(angle);
  vec3 twisted = p;
  twisted.xz = mat2(c, -s, s, c) * p.xz;

  mat3 rot = rotationY(t * 0.6) * rotationX(t * 0.35);
  vec3 q = rot * twisted;
  return sdBox(q, vec3(0.45));
}

vec3 estimateNormal(vec3 p, float t) {
  float eps = 0.0025;
  vec2 h = vec2(eps, 0.0);
  float dx = sceneSDF(p + vec3(h.x, h.y, h.y), t) - sceneSDF(p - vec3(h.x, h.y, h.y), t);
  float dy = sceneSDF(p + vec3(h.y, h.x, h.y), t) - sceneSDF(p - vec3(h.y, h.x, h.y), t);
  float dz = sceneSDF(p + vec3(h.y, h.y, h.x), t) - sceneSDF(p - vec3(h.y, h.y, h.x), t);
  return normalize(vec3(dx, dy, dz));
}

void main() {
  vec2 uv = vUV * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float time = uTime * 0.001; // milliseconds to seconds

  vec3 rayOrigin = vec3(0.0, 0.0, 3.0);
  vec3 rayDir = normalize(vec3(uv, -1.6));

  float t = 0.0;
  float hit = -1.0;
  for (int i = 0; i < 110; i++) {
    vec3 pos = rayOrigin + rayDir * t;
    float dist = sceneSDF(pos, time);
    if (dist < 0.0015) {
      hit = t;
      break;
    }
    t += dist;
    if (t > 18.0) {
      break;
    }
  }

  vec3 base = vec3(0.05, 0.12, 0.2) + vec3(0.08 * vUV.y);

  if (hit > 0.0) {
    vec3 pos = rayOrigin + rayDir * hit;
    vec3 normal = estimateNormal(pos, time);
    vec3 lightDir = normalize(vec3(0.7, 1.0, 0.3));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float spec = pow(max(dot(reflect(-lightDir, normal), -rayDir), 0.0), 32.0);
    float fresnel = pow(1.0 - max(dot(normal, -rayDir), 0.0), 3.0);

    vec3 cubeColor = mix(vec3(0.16, 0.48, 0.86), vec3(0.78, 0.91, 1.0), 0.35 + 0.35 * sin(time * 0.6));
    vec3 shaded = cubeColor * (0.2 + 0.8 * diffuse) + vec3(0.3 * spec) + vec3(0.4 * fresnel);

    float fog = exp(-0.1 * hit * hit);
    base = mix(base, shaded, fog);
  }

  outColor = vec4(pow(base, vec3(0.9)), 1.0);
}
`

const createShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Shader compile failed', gl.getShaderInfoLog(shader) || '')
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const createProgram = (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
) => {
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Program link failed', gl.getProgramInfoLog(program) || '')
    gl.deleteProgram(program)
    return null
  }
  return program
}

export const createWebglRenderer = (initialSize: number): WebglRenderer | null => {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    return null
  }

  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(initialSize, initialSize)
      : (() => {
          const element = document.createElement('canvas')
          element.width = initialSize
          element.height = initialSize
          element.style.display = 'none'
          return element
        })()

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  })

  if (!gl) {
    return null
  }

  let size = initialSize
  let frameData = new Uint8Array(size * size * 4)
  let frame: WebglFrame = { data: frameData, size, timestamp: 0 }
  let frameCounter = 0

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertexShader || !fragmentShader) {
    return null
  }

  const program = createProgram(gl, vertexShader, fragmentShader)
  if (!program) {
    return null
  }

  const timeLocation = gl.getUniformLocation(program, 'uTime')
  const resolutionLocation = gl.getUniformLocation(program, 'uResolution')

  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)

  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()

  const allocateTarget = (nextSize: number) => {
    size = Math.max(1, nextSize)
    if ('width' in canvas) {
      canvas.width = size
      canvas.height = size
    }
    frameData = new Uint8Array(size * size * 4)
    frame = { data: frameData, size, timestamp: 0 }

    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      size,
      size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  allocateTarget(size)

  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)

  const render = (timeMs: number): WebglFrame | null => {
    if (!timeLocation || !resolutionLocation) {
      return null
    }

    const start = now()

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.viewport(0, 0, size, size)
    gl.useProgram(program)
    gl.uniform1f(timeLocation, timeMs)
    gl.uniform2f(resolutionLocation, size, size)

    mark('vc-webgl-draw-start')
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    mark('vc-webgl-draw-end')
    measure('vc-webgl-draw', 'vc-webgl-draw-start', 'vc-webgl-draw-end')
    const afterDraw = now()

    frameCounter = (frameCounter + 1) % 3
    if (frameCounter === 0) {
      mark('vc-readpixels-start')
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, frameData)
      mark('vc-readpixels-end')
      measure('vc-readpixels', 'vc-readpixels-start', 'vc-readpixels-end')
      const afterRead = now()
      frame.timestamp = timeMs
      frame.metrics = {
        drawMs: afterDraw - start,
        readPixelsMs: afterRead - afterDraw,
        totalMs: afterRead - start,
      }
      return frame
    }

    return null
  }

  const resize = (nextSize: number) => {
    if (nextSize !== size) {
      allocateTarget(nextSize)
    }
  }

  const dispose = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (texture) gl.deleteTexture(texture)
    if (framebuffer) gl.deleteFramebuffer(framebuffer)
    if (vao) gl.deleteVertexArray(vao)
    if (program) gl.deleteProgram(program)
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
  }

  return { render, resize, dispose }
}
