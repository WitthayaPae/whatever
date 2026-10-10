//  Every gl* call in a file that includes this is recorded for the GL thread
//  while it is on (see gl_thread.h), and made directly while it is off.
//
//  Include it AFTER every GL header: from here on gl* names are macros.
//
//  Three kinds of call:
//    - arguments that are plain values (enums, ints, floats, offsets passed as
//      pointers): RanGLT_Call copies them and queues the call;
//    - arguments the call READS through a pointer (uploads, uniform arrays,
//      deletes): the bytes are copied into the queue with the call;
//    - calls that ANSWER (glGet*, glCreate*, status checks, mapping): run on
//      the GL thread while the caller waits. glIsEnabled and glIsTexture are
//      answered from shadow state instead, because the HUD and the render
//      targets ask every frame; glGen* comes from names generated ahead.
//
//  Vertex attribute and index "pointers" are always offsets into a bound
//  buffer in this renderer (nothing draws from client memory), so they are
//  values here.
#pragma once
#include "gl_platform.h"
#include "gl_thread.h"

#ifdef __cplusplus

#include <string.h>

//  ---- values
template <class Fn, class... A> inline void RanGLT_Call(Fn fn, A... a) {
    if (RanGLT_Direct()) { fn(a...); return; }
    auto f = [=]() { fn(a...); };
    typedef decltype(f) F;
    void *p = RanGLT_Cmd((unsigned)sizeof(F), &RanGLTClosure<F>::run);
    if (!p) return;
    new (p) F(std::move(f));
    //  The closure is per signature, so "glprof" needs the function itself.
    if (g_ranGLTProf) RanGLT_TagCmd(p, RanGLT_TagFor((const void *)fn));
}

//  ---- shadow state (gl_thunks.cpp)
void      RanGLT_ShadowCap(GLenum cap, bool on);
int       RanGLT_ShadowIsEnabled(GLenum cap, GLboolean *out);   //  1 if tracked
void      RanGLT_ShadowTexGen(const GLuint *names, GLsizei n);
void      RanGLT_ShadowTexDelete(const GLuint *names, GLsizei n);
GLboolean RanGLT_ShadowIsTexture(GLuint name);
void      RanGLT_InitShadows(void);

inline void RanGLT_glEnable(GLenum cap)  { RanGLT_ShadowCap(cap, true);  RanGLT_Call(&::glEnable, cap); }
inline void RanGLT_glDisable(GLenum cap) { RanGLT_ShadowCap(cap, false); RanGLT_Call(&::glDisable, cap); }

inline GLboolean RanGLT_glIsEnabled(GLenum cap) {
    if (RanGLT_Direct()) return ::glIsEnabled(cap);
    GLboolean r = GL_FALSE;
    if (RanGLT_ShadowIsEnabled(cap, &r)) return r;
    RanGLT_RunSync([&]() { r = ::glIsEnabled(cap); });
    return r;
}
inline GLboolean RanGLT_glIsTexture(GLuint t) {
    if (RanGLT_Direct()) return ::glIsTexture(t);
    return RanGLT_ShadowIsTexture(t);
}

//  ---- names
inline void RanGLT_genNames(int kind, GLsizei n, GLuint *out,
                            void (GL_APIENTRY *direct)(GLsizei, GLuint *)) {
    if (RanGLT_Direct()) direct(n, out);
    else for (GLsizei i = 0; i < n; ++i) out[i] = RanGLT_GenName(kind);
    if (kind == 0) RanGLT_ShadowTexGen(out, n);
}
inline void RanGLT_glGenTextures(GLsizei n, GLuint *o)      { RanGLT_genNames(0, n, o, ::glGenTextures); }
inline void RanGLT_glGenBuffers(GLsizei n, GLuint *o)       { RanGLT_genNames(1, n, o, ::glGenBuffers); }
inline void RanGLT_glGenVertexArrays(GLsizei n, GLuint *o)  { RanGLT_genNames(2, n, o, ::glGenVertexArrays); }
inline void RanGLT_glGenFramebuffers(GLsizei n, GLuint *o)  { RanGLT_genNames(3, n, o, ::glGenFramebuffers); }
inline void RanGLT_glGenRenderbuffers(GLsizei n, GLuint *o) { RanGLT_genNames(4, n, o, ::glGenRenderbuffers); }

//  ---- deletes: the names are copied
inline void RanGLT_deleteNames(GLsizei n, const GLuint *names,
                               void (GL_APIENTRY *fn)(GLsizei, const GLuint *)) {
    if (RanGLT_Direct()) { fn(n, names); return; }
    if (n <= 0 || !names) return;
    RanGLT_PostData(names, (unsigned)(n * sizeof(GLuint)),
                    [=](const void *p) { fn(n, (const GLuint *)p); });
}
inline void RanGLT_glDeleteTextures(GLsizei n, const GLuint *t) {
    RanGLT_ShadowTexDelete(t, n);
    RanGLT_deleteNames(n, t, ::glDeleteTextures);
}
inline void RanGLT_glDeleteBuffers(GLsizei n, const GLuint *b)       { RanGLT_deleteNames(n, b, ::glDeleteBuffers); }
inline void RanGLT_glDeleteVertexArrays(GLsizei n, const GLuint *v)  { RanGLT_deleteNames(n, v, ::glDeleteVertexArrays); }
inline void RanGLT_glDeleteFramebuffers(GLsizei n, const GLuint *f)  { RanGLT_deleteNames(n, f, ::glDeleteFramebuffers); }
inline void RanGLT_glDeleteRenderbuffers(GLsizei n, const GLuint *r) { RanGLT_deleteNames(n, r, ::glDeleteRenderbuffers); }

inline void RanGLT_glInvalidateFramebuffer(GLenum target, GLsizei n, const GLenum *att) {
    if (RanGLT_Direct()) { ::glInvalidateFramebuffer(target, n, att); return; }
    RanGLT_PostData(att, (unsigned)(n * sizeof(GLenum)),
                    [=](const void *p) { ::glInvalidateFramebuffer(target, n, (const GLenum *)p); });
}

//  ---- buffers
inline void RanGLT_glBufferData(GLenum target, GLsizeiptr size, const void *data, GLenum usage) {
    if (RanGLT_Direct()) { ::glBufferData(target, size, data, usage); return; }
    if (!data) { RanGLT_Call(&::glBufferData, target, size, (const void *)0, usage); return; }
    RanGLT_PostData(data, (unsigned)size,
                    [=](const void *p) { ::glBufferData(target, size, p, usage); });
}
inline void RanGLT_glBufferSubData(GLenum target, GLintptr off, GLsizeiptr size, const void *data) {
    if (RanGLT_Direct()) { ::glBufferSubData(target, off, size, data); return; }
    RanGLT_PostData(data, (unsigned)size,
                    [=](const void *p) { ::glBufferSubData(target, off, size, p); });
}

//  ---- uniforms
template <class T, class Fn> inline void RanGLT_uniformv(Fn fn, GLint loc, GLsizei count,
                                                         const T *v, unsigned perItem) {
    if (RanGLT_Direct()) { fn(loc, count, v); return; }
    RanGLT_PostData(v, (unsigned)(count * perItem * sizeof(T)),
                    [=](const void *p) { fn(loc, count, (const T *)p); });
}
inline void RanGLT_glUniform1iv(GLint l, GLsizei c, const GLint *v)   { RanGLT_uniformv(::glUniform1iv, l, c, v, 1); }
inline void RanGLT_glUniform3fv(GLint l, GLsizei c, const GLfloat *v) { RanGLT_uniformv(::glUniform3fv, l, c, v, 3); }
inline void RanGLT_glUniform4fv(GLint l, GLsizei c, const GLfloat *v) { RanGLT_uniformv(::glUniform4fv, l, c, v, 4); }
inline void RanGLT_glUniformMatrix4fv(GLint l, GLsizei c, GLboolean tr, const GLfloat *v) {
    if (RanGLT_Direct()) { ::glUniformMatrix4fv(l, c, tr, v); return; }
    RanGLT_PostData(v, (unsigned)(c * 16 * sizeof(GLfloat)),
                    [=](const void *p) { ::glUniformMatrix4fv(l, c, tr, (const GLfloat *)p); });
}

//  ---- textures
//  Bytes glTexImage2D/glTexSubImage2D read, for the formats this renderer
//  uploads, at the current unpack alignment. 0 = not one of ours.
unsigned RanGLT_PixelBytes(GLsizei w, GLsizei h, GLenum format, GLenum type);
void     RanGLT_ShadowUnpackAlignment(GLint a);

inline void RanGLT_glPixelStorei(GLenum pname, GLint v) {
    if (pname == GL_UNPACK_ALIGNMENT) RanGLT_ShadowUnpackAlignment(v);
    RanGLT_Call(&::glPixelStorei, pname, v);
}
inline void RanGLT_glTexImage2D(GLenum target, GLint level, GLint internal, GLsizei w, GLsizei h,
                                GLint border, GLenum format, GLenum type, const void *data) {
    if (RanGLT_Direct()) { ::glTexImage2D(target, level, internal, w, h, border, format, type, data); return; }
    if (!data) {
        RanGLT_Post([=]() { ::glTexImage2D(target, level, internal, w, h, border, format, type, (const void *)0); });
        return;
    }
    const unsigned bytes = RanGLT_PixelBytes(w, h, format, type);
    if (!bytes) {
        RanGLT_RunSync([&]() { ::glTexImage2D(target, level, internal, w, h, border, format, type, data); });
        return;
    }
    RanGLT_PostData(data, bytes, [=](const void *p) {
        ::glTexImage2D(target, level, internal, w, h, border, format, type, p); });
}
inline void RanGLT_glTexSubImage2D(GLenum target, GLint level, GLint x, GLint y, GLsizei w, GLsizei h,
                                   GLenum format, GLenum type, const void *data) {
    if (RanGLT_Direct()) { ::glTexSubImage2D(target, level, x, y, w, h, format, type, data); return; }
    const unsigned bytes = RanGLT_PixelBytes(w, h, format, type);
    if (!bytes) {
        RanGLT_RunSync([&]() { ::glTexSubImage2D(target, level, x, y, w, h, format, type, data); });
        return;
    }
    RanGLT_PostData(data, bytes, [=](const void *p) {
        ::glTexSubImage2D(target, level, x, y, w, h, format, type, p); });
}
inline void RanGLT_glCompressedTexImage2D(GLenum target, GLint level, GLenum internal, GLsizei w,
                                          GLsizei h, GLint border, GLsizei size, const void *data) {
    if (RanGLT_Direct()) { ::glCompressedTexImage2D(target, level, internal, w, h, border, size, data); return; }
    RanGLT_PostData(data, (unsigned)size, [=](const void *p) {
        ::glCompressedTexImage2D(target, level, internal, w, h, border, size, p); });
}

//  ---- calls that answer: run there, wait here
#define RANGLT_SYNC_RET(T, call) \
    do { if (RanGLT_Direct()) return call; T r_{}; \
         RanGLT_RunSync([&]() { r_ = call; }); return r_; } while (0)
#define RANGLT_SYNC_VOID(call) \
    do { if (RanGLT_Direct()) { call; return; } RanGLT_RunSync([&]() { call; }); } while (0)

inline GLenum  RanGLT_glCheckFramebufferStatus(GLenum t) { RANGLT_SYNC_RET(GLenum, ::glCheckFramebufferStatus(t)); }
inline GLuint  RanGLT_glCreateProgram(void)              { RANGLT_SYNC_RET(GLuint, ::glCreateProgram()); }
inline GLuint  RanGLT_glCreateShader(GLenum t)           { RANGLT_SYNC_RET(GLuint, ::glCreateShader(t)); }
inline GLenum  RanGLT_glGetError(void)                   { RANGLT_SYNC_RET(GLenum, ::glGetError()); }
inline const GLubyte *RanGLT_glGetString(GLenum n)       { RANGLT_SYNC_RET(const GLubyte *, ::glGetString(n)); }
inline GLint   RanGLT_glGetUniformLocation(GLuint p, const GLchar *n) { RANGLT_SYNC_RET(GLint, ::glGetUniformLocation(p, n)); }
inline void    RanGLT_glGetIntegerv(GLenum n, GLint *v)  { RANGLT_SYNC_VOID(::glGetIntegerv(n, v)); }
inline void    RanGLT_glGetFloatv(GLenum n, GLfloat *v)  { RANGLT_SYNC_VOID(::glGetFloatv(n, v)); }
inline void    RanGLT_glGetBooleanv(GLenum n, GLboolean *v) { RANGLT_SYNC_VOID(::glGetBooleanv(n, v)); }
inline void    RanGLT_glGetShaderiv(GLuint s, GLenum n, GLint *v) { RANGLT_SYNC_VOID(::glGetShaderiv(s, n, v)); }
inline void    RanGLT_glGetProgramiv(GLuint p, GLenum n, GLint *v) { RANGLT_SYNC_VOID(::glGetProgramiv(p, n, v)); }
inline void    RanGLT_glGetShaderInfoLog(GLuint s, GLsizei m, GLsizei *l, GLchar *o) { RANGLT_SYNC_VOID(::glGetShaderInfoLog(s, m, l, o)); }
inline void    RanGLT_glGetProgramInfoLog(GLuint p, GLsizei m, GLsizei *l, GLchar *o) { RANGLT_SYNC_VOID(::glGetProgramInfoLog(p, m, l, o)); }
inline void    RanGLT_glShaderSource(GLuint s, GLsizei c, const GLchar *const *str, const GLint *len) { RANGLT_SYNC_VOID(::glShaderSource(s, c, str, len)); }
inline void    RanGLT_glReadPixels(GLint x, GLint y, GLsizei w, GLsizei h, GLenum f, GLenum t, void *d) { RANGLT_SYNC_VOID(::glReadPixels(x, y, w, h, f, t, d)); }
inline void   *RanGLT_glMapBufferRange(GLenum t, GLintptr o, GLsizeiptr l, GLbitfield a) { RANGLT_SYNC_RET(void *, ::glMapBufferRange(t, o, l, a)); }
inline GLboolean RanGLT_glUnmapBuffer(GLenum t)          { RANGLT_SYNC_RET(GLboolean, ::glUnmapBuffer(t)); }
inline GLsync  RanGLT_glFenceSync(GLenum c, GLbitfield f) { RANGLT_SYNC_RET(GLsync, ::glFenceSync(c, f)); }
inline GLenum  RanGLT_glClientWaitSync(GLsync s, GLbitfield f, GLuint64 t) { RANGLT_SYNC_RET(GLenum, ::glClientWaitSync(s, f, t)); }
inline void    RanGLT_glDeleteSync(GLsync s)             { RanGLT_Call(&::glDeleteSync, s); }

//  ---- the switch: from here on these names are the thunks
#define glEnable(...)                  RanGLT_glEnable(__VA_ARGS__)
#define glDisable(...)                 RanGLT_glDisable(__VA_ARGS__)
#define glIsEnabled(...)               RanGLT_glIsEnabled(__VA_ARGS__)
#define glIsTexture(...)               RanGLT_glIsTexture(__VA_ARGS__)
#define glGenTextures(...)             RanGLT_glGenTextures(__VA_ARGS__)
#define glGenBuffers(...)              RanGLT_glGenBuffers(__VA_ARGS__)
#define glGenVertexArrays(...)         RanGLT_glGenVertexArrays(__VA_ARGS__)
#define glGenFramebuffers(...)         RanGLT_glGenFramebuffers(__VA_ARGS__)
#define glGenRenderbuffers(...)        RanGLT_glGenRenderbuffers(__VA_ARGS__)
#define glDeleteTextures(...)          RanGLT_glDeleteTextures(__VA_ARGS__)
#define glDeleteBuffers(...)           RanGLT_glDeleteBuffers(__VA_ARGS__)
#define glDeleteVertexArrays(...)      RanGLT_glDeleteVertexArrays(__VA_ARGS__)
#define glDeleteFramebuffers(...)      RanGLT_glDeleteFramebuffers(__VA_ARGS__)
#define glDeleteRenderbuffers(...)     RanGLT_glDeleteRenderbuffers(__VA_ARGS__)
#define glInvalidateFramebuffer(...)   RanGLT_glInvalidateFramebuffer(__VA_ARGS__)
#define glBufferData(...)              RanGLT_glBufferData(__VA_ARGS__)
#define glBufferSubData(...)           RanGLT_glBufferSubData(__VA_ARGS__)
#define glUniform1iv(...)              RanGLT_glUniform1iv(__VA_ARGS__)
#define glUniform3fv(...)              RanGLT_glUniform3fv(__VA_ARGS__)
#define glUniform4fv(...)              RanGLT_glUniform4fv(__VA_ARGS__)
#define glUniformMatrix4fv(...)        RanGLT_glUniformMatrix4fv(__VA_ARGS__)
#define glPixelStorei(...)             RanGLT_glPixelStorei(__VA_ARGS__)
#define glTexImage2D(...)              RanGLT_glTexImage2D(__VA_ARGS__)
#define glTexSubImage2D(...)           RanGLT_glTexSubImage2D(__VA_ARGS__)
#define glCompressedTexImage2D(...)    RanGLT_glCompressedTexImage2D(__VA_ARGS__)
#define glCheckFramebufferStatus(...)  RanGLT_glCheckFramebufferStatus(__VA_ARGS__)
#define glCreateProgram(...)           RanGLT_glCreateProgram(__VA_ARGS__)
#define glCreateShader(...)            RanGLT_glCreateShader(__VA_ARGS__)
#define glGetError(...)                RanGLT_glGetError(__VA_ARGS__)
#define glGetString(...)               RanGLT_glGetString(__VA_ARGS__)
#define glGetUniformLocation(...)      RanGLT_glGetUniformLocation(__VA_ARGS__)
#define glGetIntegerv(...)             RanGLT_glGetIntegerv(__VA_ARGS__)
#define glGetFloatv(...)               RanGLT_glGetFloatv(__VA_ARGS__)
#define glGetBooleanv(...)             RanGLT_glGetBooleanv(__VA_ARGS__)
#define glGetShaderiv(...)             RanGLT_glGetShaderiv(__VA_ARGS__)
#define glGetProgramiv(...)            RanGLT_glGetProgramiv(__VA_ARGS__)
#define glGetShaderInfoLog(...)        RanGLT_glGetShaderInfoLog(__VA_ARGS__)
#define glGetProgramInfoLog(...)       RanGLT_glGetProgramInfoLog(__VA_ARGS__)
#define glShaderSource(...)            RanGLT_glShaderSource(__VA_ARGS__)
#define glReadPixels(...)              RanGLT_glReadPixels(__VA_ARGS__)
#define glMapBufferRange(...)          RanGLT_glMapBufferRange(__VA_ARGS__)
#define glUnmapBuffer(...)             RanGLT_glUnmapBuffer(__VA_ARGS__)
#define glFenceSync(...)               RanGLT_glFenceSync(__VA_ARGS__)
#define glClientWaitSync(...)          RanGLT_glClientWaitSync(__VA_ARGS__)
#define glDeleteSync(...)              RanGLT_glDeleteSync(__VA_ARGS__)

//  Plain values.
#define glActiveTexture(...)           RanGLT_Call(&::glActiveTexture, __VA_ARGS__)
#define glAttachShader(...)            RanGLT_Call(&::glAttachShader, __VA_ARGS__)
#define glBindBuffer(...)              RanGLT_Call(&::glBindBuffer, __VA_ARGS__)
#define glBindFramebuffer(...)         RanGLT_Call(&::glBindFramebuffer, __VA_ARGS__)
#define glBindRenderbuffer(...)        RanGLT_Call(&::glBindRenderbuffer, __VA_ARGS__)
#define glBindTexture(...)             RanGLT_Call(&::glBindTexture, __VA_ARGS__)
#define glBindVertexArray(...)         RanGLT_Call(&::glBindVertexArray, __VA_ARGS__)
#define glBlendEquation(...)           RanGLT_Call(&::glBlendEquation, __VA_ARGS__)
#define glBlendFunc(...)               RanGLT_Call(&::glBlendFunc, __VA_ARGS__)
#define glBlitFramebuffer(...)         RanGLT_Call(&::glBlitFramebuffer, __VA_ARGS__)
#define glClear(...)                   RanGLT_Call(&::glClear, __VA_ARGS__)
#define glClearColor(...)              RanGLT_Call(&::glClearColor, __VA_ARGS__)
#define glClearDepthf(...)             RanGLT_Call(&::glClearDepthf, __VA_ARGS__)
#define glClearStencil(...)            RanGLT_Call(&::glClearStencil, __VA_ARGS__)
#define glColorMask(...)               RanGLT_Call(&::glColorMask, __VA_ARGS__)
#define glCompileShader(...)           RanGLT_Call(&::glCompileShader, __VA_ARGS__)
#define glCullFace(...)                RanGLT_Call(&::glCullFace, __VA_ARGS__)
#define glDeleteProgram(...)           RanGLT_Call(&::glDeleteProgram, __VA_ARGS__)
#define glDeleteShader(...)            RanGLT_Call(&::glDeleteShader, __VA_ARGS__)
#define glDepthFunc(...)               RanGLT_Call(&::glDepthFunc, __VA_ARGS__)
#define glDepthMask(...)               RanGLT_Call(&::glDepthMask, __VA_ARGS__)
#define glDepthRangef(...)             RanGLT_Call(&::glDepthRangef, __VA_ARGS__)
#define glDisableVertexAttribArray(...) RanGLT_Call(&::glDisableVertexAttribArray, __VA_ARGS__)
#define glDrawArrays(...)              RanGLT_Call(&::glDrawArrays, __VA_ARGS__)
#define glDrawElements(...)            RanGLT_Call(&::glDrawElements, __VA_ARGS__)
#define glEnableVertexAttribArray(...) RanGLT_Call(&::glEnableVertexAttribArray, __VA_ARGS__)
#define glFramebufferRenderbuffer(...) RanGLT_Call(&::glFramebufferRenderbuffer, __VA_ARGS__)
#define glFramebufferTexture2D(...)    RanGLT_Call(&::glFramebufferTexture2D, __VA_ARGS__)
#define glFrontFace(...)               RanGLT_Call(&::glFrontFace, __VA_ARGS__)
#define glGenerateMipmap(...)          RanGLT_Call(&::glGenerateMipmap, __VA_ARGS__)
#define glLinkProgram(...)             RanGLT_Call(&::glLinkProgram, __VA_ARGS__)
#define glPolygonOffset(...)           RanGLT_Call(&::glPolygonOffset, __VA_ARGS__)
#define glRenderbufferStorage(...)     RanGLT_Call(&::glRenderbufferStorage, __VA_ARGS__)
#define glScissor(...)                 RanGLT_Call(&::glScissor, __VA_ARGS__)
#define glTexParameterf(...)           RanGLT_Call(&::glTexParameterf, __VA_ARGS__)
#define glTexParameteri(...)           RanGLT_Call(&::glTexParameteri, __VA_ARGS__)
#define glUniform1f(...)               RanGLT_Call(&::glUniform1f, __VA_ARGS__)
#define glUniform1i(...)               RanGLT_Call(&::glUniform1i, __VA_ARGS__)
#define glUniform2f(...)               RanGLT_Call(&::glUniform2f, __VA_ARGS__)
#define glUniform4f(...)               RanGLT_Call(&::glUniform4f, __VA_ARGS__)
#define glUseProgram(...)              RanGLT_Call(&::glUseProgram, __VA_ARGS__)
#define glVertexAttrib2f(...)          RanGLT_Call(&::glVertexAttrib2f, __VA_ARGS__)
#define glVertexAttrib3f(...)          RanGLT_Call(&::glVertexAttrib3f, __VA_ARGS__)
#define glVertexAttrib4f(...)          RanGLT_Call(&::glVertexAttrib4f, __VA_ARGS__)
#define glVertexAttribPointer(...)     RanGLT_Call(&::glVertexAttribPointer, __VA_ARGS__)
#define glViewport(...)                RanGLT_Call(&::glViewport, __VA_ARGS__)
//  ES 3.1 / EXT entry points the renderer holds in variables (gl_render.cpp).
//  A function-like macro only expands before "(", so the variables' own
//  definitions and assignments are untouched. The timer-query ones are not
//  here: they write results through pointers, and the GPU sections are off
//  while the GL thread is on.
#define p_glVertexAttribFormat(...)    RanGLT_Call(p_glVertexAttribFormat, __VA_ARGS__)
#define p_glVertexAttribBinding(...)   RanGLT_Call(p_glVertexAttribBinding, __VA_ARGS__)
#define p_glBindVertexBuffer(...)      RanGLT_Call(p_glBindVertexBuffer, __VA_ARGS__)

#endif  //  __cplusplus
