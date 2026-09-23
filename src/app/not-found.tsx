import Link from "next/link";

/**
 * not-found.tsx — v10.6 (F6) : page 404 personnalisée. Avant, le 404 par
 * défaut de Next s'ajoutait au <title> du layout → DOUBLE <title> (HTML
 * invalide, onglet incohérent). Avec cette page dédiée, un seul titre est
 * rendu et le style reste monochrome cohérent.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        background: "#fff",
        color: "#111",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: "48px", fontWeight: 700, margin: 0, letterSpacing: "2px" }}>
        ◆ 404
      </p>
      <h1 style={{ fontSize: "20px", margin: 0 }}>Cette page n&apos;existe pas.</h1>
      <p style={{ fontSize: "14px", opacity: 0.7, margin: 0, maxWidth: "420px" }}>
        L&apos;adresse demandée n&apos;a été trouvée ni dans les routes de la
        passerelle ni dans le registre du moteur Athéna.
      </p>
      <Link
        href="/"
        style={{
          color: "#c1121f",
          textDecoration: "underline",
          fontSize: "14px",
          marginTop: "8px",
        }}
      >
        Retour à la discussion
      </Link>
    </div>
  );
}
