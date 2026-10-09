//  Shadow state for gl_thunks.h: the few questions the renderer asks GL every
//  frame, answered on the recording thread without waiting for the GL thread.
//
//  Written by the thunks on whichever side issues the call (the recording
//  thread, or the GL thread inside a RanGLT_RunSync while the recorder waits),
//  so it is only ever touched by one thread at a time.
#include "gl_platform.h"
#include "gl_thread.h"
#include <unordered_set>

namespace {

//  The capabilities the renderer enables and disables, in a fixed order.
const GLenum kCaps[] = {
    GL_SCISSOR_TEST, GL_BLEND, GL_DEPTH_TEST, GL_CULL_FACE, GL_STENCIL_TEST,
    GL_POLYGON_OFFSET_FILL, GL_DITHER, GL_SAMPLE_ALPHA_TO_COVERAGE, GL_SAMPLE_COVERAGE,
    GL_RASTERIZER_DISCARD, GL_PRIMITIVE_RESTART_FIXED_INDEX,
};
const int kCapCount = (int)(sizeof(kCaps) / sizeof(kCaps[0]));
bool g_cap[kCapCount];
bool g_capKnown = false;

std::unordered_set<GLuint> g_liveTextures;
GLint g_unpackAlign = 4;

int capIndex(GLenum cap) {
    for (int i = 0; i < kCapCount; ++i) if (kCaps[i] == cap) return i;
    return -1;
}

}  // namespace

void RanGLT_ShadowCap(GLenum cap, bool on) {
    const int i = capIndex(cap);
    if (i >= 0) g_cap[i] = on;
}

int RanGLT_ShadowIsEnabled(GLenum cap, GLboolean *out) {
    const int i = capIndex(cap);
    if (i < 0 || !g_capKnown) return 0;
    *out = g_cap[i] ? GL_TRUE : GL_FALSE;
    return 1;
}

void RanGLT_ShadowTexGen(const GLuint *names, GLsizei n) {
    for (GLsizei i = 0; i < n; ++i) if (names[i]) g_liveTextures.insert(names[i]);
}

void RanGLT_ShadowTexDelete(const GLuint *names, GLsizei n) {
    if (!names) return;
    for (GLsizei i = 0; i < n; ++i) g_liveTextures.erase(names[i]);
}

GLboolean RanGLT_ShadowIsTexture(GLuint name) {
    return (name && g_liveTextures.count(name)) ? GL_TRUE : GL_FALSE;
}

void RanGLT_ShadowUnpackAlignment(GLint a) { g_unpackAlign = a; }

unsigned RanGLT_PixelBytes(GLsizei w, GLsizei h, GLenum format, GLenum type) {
    if (w <= 0 || h <= 0) return 0;
    unsigned comps = 0;
    switch (format) {
        case GL_RGBA: comps = 4; break;
        case GL_RGB:  comps = 3; break;
        case GL_RG: case GL_LUMINANCE_ALPHA: comps = 2; break;
        case GL_RED: case GL_ALPHA: case GL_LUMINANCE: comps = 1; break;
        default: return 0;
    }
    unsigned bpp = 0;
    switch (type) {
        case GL_UNSIGNED_BYTE: bpp = comps; break;
        case GL_UNSIGNED_SHORT_5_6_5:
        case GL_UNSIGNED_SHORT_4_4_4_4:
        case GL_UNSIGNED_SHORT_5_5_5_1: bpp = 2; break;
        default: return 0;
    }
    const unsigned a = (unsigned)(g_unpackAlign > 0 ? g_unpackAlign : 1);
    const unsigned row = ((unsigned)w * bpp + a - 1) / a * a;
    //  The last row is read only as far as its pixels go.
    return row * (unsigned)(h - 1) + (unsigned)w * bpp;
}

//  The capabilities as GL has them now. Called right after the context moved,
//  on the recording thread; the query itself runs on the GL thread.
void RanGLT_InitShadows(void) {
    struct Ctx { bool cap[kCapCount]; GLint align; } c;
    RanGLT_RunSyncFn([](void *p) {
        Ctx *c = (Ctx *)p;
        for (int i = 0; i < kCapCount; ++i) c->cap[i] = glIsEnabled(kCaps[i]) == GL_TRUE;
        glGetIntegerv(GL_UNPACK_ALIGNMENT, &c->align);
        while (glGetError() != GL_NO_ERROR) {}
    }, &c);
    for (int i = 0; i < kCapCount; ++i) g_cap[i] = c.cap[i];
    g_unpackAlign = c.align;
    g_capKnown = true;
}
