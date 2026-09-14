import unittest

from refserver_foreign_issuers import (
    canonicalize_foreign_issuer,
    catalog_country_variants,
    issuer_spelling_key,
    issuer_from_legends,
)


class ForeignIssuerTest(unittest.TestCase):
    def test_st_helena_is_a_spelling_variant(self):
        self.assertEqual("Saint Helena", canonicalize_foreign_issuer("St. Helena"))
        self.assertEqual(
            ("Saint Helena", "St. Helena"),
            catalog_country_variants("ST HELENA"),
        )

    def test_literal_issuer_overrides_no_parent_state(self):
        self.assertEqual(
            "Saint Helena",
            issuer_from_legends(["CHARLES III", "ST. HELENA", "ONE POUND"]),
        )
        self.assertEqual(
            "United Kingdom",
            canonicalize_foreign_issuer("United Kingdom"),
        )

    def test_joint_issuer_stays_separate(self):
        self.assertEqual(
            "Saint Helena & Ascension",
            issuer_from_legends(["SAINT HELENA & ASCENSION"]),
        )
        self.assertNotIn(
            "Saint Helena",
            catalog_country_variants("Saint Helena & Ascension"),
        )

    def test_dependencies_stay_separate(self):
        self.assertEqual(
            "St. Helena Dependencies",
            issuer_from_legends(["ST. HELENA DEPENDENCIES"]),
        )
        self.assertNotIn(
            "Saint Helena",
            catalog_country_variants("St. Helena Dependencies"),
        )

    def test_unknown_and_three_territory_issuers_are_not_guessed(self):
        self.assertIsNone(issuer_from_legends(["ELIZABETH II", "ONE POUND"]))
        self.assertIsNone(
            issuer_from_legends(["SAINT HELENA, ASCENSION AND TRISTAN DA CUNHA"])
        )
        self.assertEqual("Prussia", canonicalize_foreign_issuer("Prussia"))

    def test_audit_key_groups_only_spelling_shape(self):
        self.assertEqual(
            issuer_spelling_key("St. Kitts & Nevis"),
            issuer_spelling_key("Saint Kitts and Nevis"),
        )
        self.assertNotEqual(
            issuer_spelling_key("Saint Helena"),
            issuer_spelling_key("Saint Helena & Ascension"),
        )

    def test_catalog_audit_variants_are_queryable_together(self):
        self.assertEqual(
            ("Turks and Caicos Islands", "Turks & Caicos Islands"),
            catalog_country_variants("Turks & Caicos Islands"),
        )
        self.assertEqual("Curaçao", canonicalize_foreign_issuer("Curacao"))
        self.assertEqual("Réunion", canonicalize_foreign_issuer("Reunion"))

if __name__ == "__main__":
    unittest.main()
