"use client";

// Rendered in place of the root layout, outside every provider (no language
// context), so the copy is shown in both languages.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>Something went wrong · เกิดข้อผิดพลาด</h1>
          <p style={{ color: "#666", fontSize: 13 }}>The application hit an unexpected error. · ระบบพบข้อผิดพลาดที่ไม่คาดคิด</p>
          <button
            onClick={() => reset()}
            style={{ marginTop: 12, padding: "8px 14px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer" }}
          >
            Reload · โหลดใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
