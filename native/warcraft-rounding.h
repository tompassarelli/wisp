/*
 * Lua 5.3 arithmetic as Warcraft III's Lua does it, for a LUA_32BITS build:
 *
 *   make posix MYCFLAGS="-DLUA_32BITS -include /path/to/warcraft-rounding.h"
 *
 * Warcraft's numbers are binary32, and its raw float + - * round the exact
 * result toward zero, not to nearest: in Smashcraft 0.0.48 the product
 * 4.1f * 0.94f was 23.12399673461914 natively, the exact product truncated,
 * where round-to-nearest gives 23.123998641967773 (smashcraft#59). Division
 * rounds to nearest. Code whose results must equal a round-to-nearest host
 * (Wisp's f32 helpers, Bun) then shows any raw float operation it relies on
 * as a difference from the host.
 *
 * A binary32 product is exact in a double. A sum is exact as the double s
 * plus its rounding error e (Knuth's two-sum); s + e has the true result's
 * sign and magnitude relative to s, which decides the truncation.
 */
#include <float.h>
#include <math.h>

static inline float warcraft_toward_zero(double s, double e) {
  float f = (float)s;
  if (isinf(f) && !isinf(s)) return s > 0 ? FLT_MAX : -FLT_MAX;
  if (!isfinite(f) || f == 0.0f) return f;
  double rounded = (double)f;
  int away = rounded != s ? fabs(rounded) > fabs(s) : (s > 0 ? e < 0 : e > 0);
  return away ? nextafterf(f, 0.0f) : f;
}

static inline float warcraft_add(float a, float b) {
  double x = a, y = b, s = x + y;
  double yy = s - x;
  double e = (x - (s - yy)) + (y - yy);
  return warcraft_toward_zero(s, isfinite(s) ? e : 0.0);
}

static inline float warcraft_multiply(float a, float b) {
  return warcraft_toward_zero((double)a * (double)b, 0.0);
}

/* llimits.h defines these together unless luai_numadd is already defined. */
#define luai_numadd(L,a,b) warcraft_add((a),(b))
#define luai_numsub(L,a,b) warcraft_add((a),-(b))
#define luai_nummul(L,a,b) warcraft_multiply((a),(b))
#define luai_numunm(L,a) (-(a))
#define luai_numeq(a,b) ((a)==(b))
#define luai_numlt(a,b) ((a)<(b))
#define luai_numle(a,b) ((a)<=(b))
#define luai_numisnan(a) (!luai_numeq((a), (a)))
