-- Discarded karute records remain durable but are hidden from ordinary reads.
-- PostgreSQL requires an enum value to be committed before statements use it.

ALTER TYPE "KaruteStatus" ADD VALUE IF NOT EXISTS 'DISCARDED';
