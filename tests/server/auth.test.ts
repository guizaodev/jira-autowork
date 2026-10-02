import { describe, expect, test } from "bun:test";
import {
  PROXY_MASK,
  isMaskedProxy,
  issueSessionToken,
  maskCookie,
  maskProxy,
  SESSION_TTL_MS,
  verifySessionToken,
} from "../../src/server/auth";

describe("server / auth", () => {
  test("token emitido verifica com a senha correta", () => {
    const token = issueSessionToken("senha");
    expect(verifySessionToken(token, "senha")).toBe(true);
    expect(verifySessionToken(token, "outra")).toBe(false);
  });

  test("token ausente/inválido rejeitado", () => {
    expect(verifySessionToken(undefined, "senha")).toBe(false);
    expect(verifySessionToken("", "senha")).toBe(false);
    expect(verifySessionToken("lixo", "senha")).toBe(false);
    expect(verifySessionToken("abc.def", "senha")).toBe(false);
  });

  test("token expirado rejeitado", () => {
    const now = 1_000_000;
    const token = issueSessionToken("senha", now);
    expect(verifySessionToken(token, "senha", now + SESSION_TTL_MS - 1)).toBe(
      true,
    );
    expect(verifySessionToken(token, "senha", now + SESSION_TTL_MS + 1)).toBe(
      false,
    );
  });

  test("adulteração da assinatura rejeitada", () => {
    const token = issueSessionToken("senha");
    const [expires] = token.split(".");
    expect(verifySessionToken(`${expires}.deadbeef`, "senha")).toBe(false);
  });

  test("maskCookie não vaza valor", () => {
    expect(maskCookie("JSESSIONID=abc")).toBe("••••••••");
    expect(maskCookie("  ")).toBe("");
  });

  test("maskProxy mascara userinfo e preserva sem credenciais", () => {
    expect(maskProxy("http://user:pass@proxy.corp:8080")).toBe(
      "http://***:***@proxy.corp:8080",
    );
    expect(maskProxy("https://u:p@host:3128")).toBe("https://***:***@host:3128");
    expect(maskProxy("http://proxy.corp:8080")).toBe("http://proxy.corp:8080");
    expect(maskProxy("")).toBe("");
  });

  test("maskProxy detecta userinfo com @ literal na senha", () => {
    expect(maskProxy("http://user:p@ss@proxy.corp:8080")).toBe(
      "http://***:***@proxy.corp:8080",
    );
  });

  test("maskProxy mascara userinfo sem scheme (estilo curl -x)", () => {
    expect(maskProxy("user:pass@proxy.corp:8080")).toBe(
      "***:***@proxy.corp:8080",
    );
    expect(maskProxy("proxy.corp:8080")).toBe("proxy.corp:8080");
  });

  test("maskProxy idempotente e preserva IPv6 sem credenciais", () => {
    const masked = maskProxy("http://user:pass@proxy.corp:8080");
    expect(maskProxy(masked)).toBe(masked);
    expect(maskProxy("http://[::1]:8080")).toBe("http://[::1]:8080");
  });

  test("isMaskedProxy identifica apenas a máscara estrutural", () => {
    expect(isMaskedProxy("http://***:***@proxy.corp:8080")).toBe(true);
    expect(isMaskedProxy(`${PROXY_MASK}proxy.corp:8080`)).toBe(true);
    expect(isMaskedProxy("http://proxy.corp:8080")).toBe(false);
    expect(
      isMaskedProxy("http://x***:***@y@proxy.corp:8080"),
    ).toBe(false);
    expect(isMaskedProxy("")).toBe(false);
  });
});
