-- Anmelden mit Google.
--
-- Zwei Änderungen, beide rückwärtskompatibel: das Passwort darf fehlen (bei
-- Konten, die nur über Google hereinkommen), und Googles unveränderliche
-- Konto-ID bekommt eine Spalte. An ihr hängt die Zuordnung, nicht an der
-- E-Mail-Adresse — die kann sich ändern, die ID nicht.
ALTER TABLE IF EXISTS "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE IF EXISTS "User" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleId_key" ON "User"("googleId");
