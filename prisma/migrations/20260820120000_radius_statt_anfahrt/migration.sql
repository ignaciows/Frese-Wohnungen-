-- Bestehende Suchprofile auf den Umkreis umstellen.
--
-- Die Entfernung wird jetzt als Radius in Kilometern gewählt statt als
-- geschätzte Fahrzeit. Ohne diese Migration gälte das nur für Kandidaten, die
-- ab heute angelegt werden — und ein Werkzeug, dessen Verbesserungen die
-- bestehenden zwanzig Fälle nicht erreichen, verbessert nichts.
--
-- Die Umrechnung ist bewusst verhaltensneutral: die Bewertung nutzt die
-- Fahrzeit ohnehin nur, wenn eine echte Entfernung vorliegt (also mit
-- Geokodierung), und der Suchlauf setzte für einen fehlenden Radius längst
-- `min(60, Fahrzeit)` ein. Genau dieselbe Zahl wird hier festgeschrieben.
-- Niemandes Suche wird dadurch enger oder weiter — sie steht nur endlich in
-- der Einheit da, in der sie gewählt und angezeigt wird.
UPDATE "SearchProfile"
SET "radiusKm" = LEAST(60, GREATEST(1, "maxCommuteMinutes"))
WHERE "radiusKm" IS NULL
  AND "maxCommuteMinutes" IS NOT NULL;

-- Profile ohne beides bekommen den Standard, damit kein Fall ohne
-- Entfernungsgrenze dasteht.
UPDATE "SearchProfile"
SET "radiusKm" = 10
WHERE "radiusKm" IS NULL;

-- Und die Fahrzeit verschwindet, wo ein Radius steht. Beides gesetzt heißt,
-- dass die Bewertung auf die Minuten schaut — die Zahl, die niemand gewählt
-- hat und die niemand mehr sieht.
UPDATE "SearchProfile"
SET "maxCommuteMinutes" = NULL
WHERE "radiusKm" IS NOT NULL;
