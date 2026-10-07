/*
 * Lua 5.3 whose raw float + - * / and decimal numerals round the exact result
 * toward zero, for a LUA_32BITS build:
 *
 *   make posix MYCFLAGS="-DLUA_32BITS -include /path/to/toward-zero.h"
 *
 * Warcraft III's Lua numbers are binary32, and its raw float arithmetic
 * doesn't always round to nearest: in Smashcraft 0.0.48 the product
 * 4.1f * 0.94f was 23.12399673461914 natively, the exact product truncated,
 * where rounding to nearest gives 23.123998641967773 (smashcraft#59). On
 * 7 October 2026 its quotient 379.64484f / 0.49583164f was an ulp above the
 * nearest, and the numeral 0.016666667 read as the binary32 below it, where
 * the nearest is above. Its exact rule is not known; toward zero is the
 * nearest model found. Code that gives the same results here as in a stock
 * Lua32 relies on no raw float + - * / and no numeral that isn't exactly
 * binary32, whatever Warcraft's rule is.
 *
 * A binary32 product is exact in a double. A sum is exact as the double s
 * plus its rounding error e (Knuth's two-sum); s + e has the true result's
 * sign and magnitude relative to s, which decides the truncation. A quotient
 * q's remainder a - q * b is exact in a double, so its sign does.
 */
#include <float.h>
#include <math.h>
#include <stdlib.h>

static inline float toward_zero(double s, double e) {
  float f = (float)s;
  if (isinf(f) && !isinf(s)) return s > 0 ? FLT_MAX : -FLT_MAX;
  if (!isfinite(f) || f == 0.0f) return f;
  double rounded = (double)f;
  int away = rounded != s ? fabs(rounded) > fabs(s) : (s > 0 ? e < 0 : e > 0);
  return away ? nextafterf(f, 0.0f) : f;
}

static inline float toward_zero_add(float a, float b) {
  double x = a, y = b, s = x + y;
  double yy = s - x;
  double e = (x - (s - yy)) + (y - yy);
  return toward_zero(s, isfinite(s) ? e : 0.0);
}

static inline float toward_zero_multiply(float a, float b) {
  return toward_zero((double)a * (double)b, 0.0);
}

static inline float toward_zero_divide(float a, float b) {
  float q = a / b;
  if (isinf(q) && isfinite(a) && b != 0.0f) return (q > 0) ? FLT_MAX : -FLT_MAX;
  if (!isfinite(q) || q == 0.0f) return q;
  /* q * b has at most 48 significant bits and lies within an ulp of a. */
  double remainder = (double)a - (double)q * (double)b;
  /* |q| exceeds the exact quotient when the remainder's sign opposes a's. */
  int away = remainder != 0.0 && ((remainder < 0) != (a < 0));
  return away ? nextafterf(q, 0.0f) : q;
}

/* Numerals (and tonumber): the double strtod reads, a decimal's nearest, truncated to binary32. */
static inline float toward_zero_strtof(const char *text, char **end) {
  double value = strtod(text, end);
  float f = (float)value;
  if (isinf(f) && !isinf(value)) return value > 0 ? FLT_MAX : -FLT_MAX;
  return f != 0.0f && isfinite(f) && fabs((double)f) > fabs(value) ? nextafterf(f, 0.0f) : f;
}

/* luaconf.h reads numerals with l_mathop(strtod), which is strtof in a float build. */
#define strtof toward_zero_strtof

/* llimits.h defines these together unless luai_numadd is already defined. */
#define luai_numadd(L,a,b) toward_zero_add((a),(b))
#define luai_numsub(L,a,b) toward_zero_add((a),-(b))
#define luai_nummul(L,a,b) toward_zero_multiply((a),(b))
#define luai_numunm(L,a) (-(a))
#define luai_numeq(a,b) ((a)==(b))
#define luai_numlt(a,b) ((a)<(b))
#define luai_numle(a,b) ((a)<=(b))
#define luai_numisnan(a) (!luai_numeq((a), (a)))
/* llimits.h defines it unless it is already defined. */
#define luai_numdiv(L,a,b) toward_zero_divide((a),(b))
