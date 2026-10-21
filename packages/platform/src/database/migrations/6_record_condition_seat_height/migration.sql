-- the piece's condition (品相) in the collector's words; null until noted
ALTER TABLE "records" ADD COLUMN "condition" text;

-- a seat's height (座高) is a length, measured apart from the overall height
ALTER TABLE "record_measurements" DROP CONSTRAINT "record_measurements_unit_ck";
ALTER TABLE "record_measurements" ADD CONSTRAINT "record_measurements_unit_ck" CHECK ((("kind" = 'weight') AND ("unit" IN ('g', 'kg'))) OR (("kind" IN ('height', 'width', 'depth', 'diameter', 'seatHeight')) AND ("unit" IN ('mm', 'cm', 'm'))));
