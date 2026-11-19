import csv
from pathlib import Path
import tempfile
import unittest
from import_ecdict import import_dataset, split_sections, normalize_word


class ImportTests(unittest.TestCase):
    def fixture(self, rows, header=None):
        directory = tempfile.TemporaryDirectory(prefix='dictionary-ecdict-test-')
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'fixture.csv'
        with path.open('w', encoding='utf-8', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(header or ['word', 'definition', 'translation', 'pos'])
            writer.writerows(rows)
        return path

    def test_real_csv_quoting_newlines_and_source_locations(self):
        path = self.fixture([['create', 'v. bring, into existence\nv. invent', 'vt. 测试,造物', 'v:90/n:10']])
        result = import_dataset(path, {'create'}, 'test-fixture')
        record = result['records'][0]
        self.assertEqual(len(record['definitions']), 2)
        self.assertEqual(record['raw']['definition'], 'v. bring, into existence\nv. invent')
        self.assertEqual(record['locator']['dataRecordNumber'], 1)
        self.assertEqual(record['locator']['physicalEndLine'], 3)
        self.assertEqual(record['corpusPos'], 'v:90/n:10')
        self.assertEqual(record['bilingualAlignment'], 'not_provided')

    def test_escaped_newlines_and_wordnet_pos(self):
        self.assertEqual([s['partOfSpeech'] for s in split_sections('s. creative\\nr. creatively\\nn. creation')], [['adjective'], ['adverb'], ['noun']])
        self.assertEqual(split_sections('vt. 测试')[0]['partOfSpeech'], ['verb'])
        self.assertEqual(split_sections('[化] 测试')[0]['partOfSpeech'], [])

    def test_normalized_duplicates_preserve_original_trace(self):
        path = self.fixture([[' CREATE ', 'v. invent', 'vt. 测试', ''], ['create', 'v.  invent', 'vt. 测试', '']])
        result = import_dataset(path, {'create'}, 'test-fixture')
        self.assertEqual(result['statistics']['duplicateSelectedRows'], 1)
        self.assertEqual(len(result['records']), 1)
        self.assertEqual(result['records'][0]['duplicateLocations'][0]['dataRecordNumber'], 2)
        self.assertEqual(result['records'][0]['raw']['word'], ' CREATE ')

    def test_repeat_is_byte_equivalent_and_scope_is_bounded(self):
        path = self.fixture([['create', 'v. invent', 'vt. 测试', ''], ['unrelated', 'n. other', 'n. 其他', '']])
        self.assertEqual(import_dataset(path, {'create'}, 'v1'), import_dataset(path, {'create'}, 'v1'))
        self.assertEqual(len(import_dataset(path, {'create'}, 'v1')['records']), 1)
        self.assertNotEqual(normalize_word('make-sense'), normalize_word('make sense'))

    def test_missing_fields_and_invalid_rows_are_not_fabricated(self):
        path = self.fixture([['make sense', '', '测试译文', ''], ['wrong', 'column'], ['', '', '', '']])
        result = import_dataset(path, {'make sense'}, 'v1')
        self.assertEqual(result['statistics']['invalidColumnRows'], 1)
        self.assertEqual(result['statistics']['blankWords'], 1)
        self.assertIn('missing_english_definition', result['records'][0]['issues'])
        self.assertEqual(result['records'][0]['definitions'], [])

    def test_rejects_invalid_header(self):
        path = self.fixture([], ['word', 'word'])
        with self.assertRaises(ValueError):
            import_dataset(path, {'create'}, 'v1')


if __name__ == '__main__':
    unittest.main()
