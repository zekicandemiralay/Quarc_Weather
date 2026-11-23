package com.quarc.weather;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/** The list of places the app hands the widget: tolerant on the way in, stable on the way out. */
public class WidgetCitiesTest {

    @Test
    public void parsesPlacesInOrderMyLocationFirst() {
        List<WidgetCities.Place> p = WidgetCities.parse(
            "[{\"id\":\"here\",\"name\":\"Cankurtaran\",\"latitude\":41.008,\"longitude\":28.978,\"isPin\":true},"
          + "{\"id\":\"c_5252_1340\",\"name\":\"Berlin\",\"latitude\":52.52,\"longitude\":13.405,\"isPin\":false}]");
        assertEquals(2, p.size());
        assertEquals("here", p.get(0).id);
        assertTrue(p.get(0).isPin);
        assertEquals("Berlin", p.get(1).name);
        assertFalse(p.get(1).isPin);
        assertEquals(52.52, p.get(1).latitude, 0.0001);
    }

    @Test
    public void dropsEntriesThatCannotBeUsedInsteadOfFailing() {
        List<WidgetCities.Place> p = WidgetCities.parse(
            "[{\"id\":\"\",\"name\":\"no id\",\"latitude\":1,\"longitude\":1},"
          + "{\"id\":\"a\",\"name\":\"no coords\"},"
          + "{\"id\":\"b\",\"name\":\"off the map\",\"latitude\":123,\"longitude\":10},"
          + "{\"id\":\"c\",\"name\":\"off the map too\",\"latitude\":10,\"longitude\":-200},"
          + "42,"
          + "{\"id\":\"ok\",\"name\":\"Fine\",\"latitude\":10,\"longitude\":20}]");
        assertEquals(1, p.size());
        assertEquals("ok", p.get(0).id);
    }

    @Test
    public void garbageAndEmptyInputGiveAnEmptyListNotACrash() {
        assertTrue(WidgetCities.parse(null).isEmpty());
        assertTrue(WidgetCities.parse("").isEmpty());
        assertTrue(WidgetCities.parse("not json").isEmpty());
        assertTrue(WidgetCities.parse("{\"id\":\"x\"}").isEmpty());
        assertTrue(WidgetCities.parse("[]").isEmpty());
    }

    @Test
    public void aMissingNameBecomesADash() {
        List<WidgetCities.Place> p = WidgetCities.parse("[{\"id\":\"a\",\"latitude\":1,\"longitude\":2}]");
        assertEquals("—", p.get(0).name);
    }

    @Test
    public void survivesAStoreAndReload() {
        List<WidgetCities.Place> original = WidgetCities.parse(
            "[{\"id\":\"here\",\"name\":\"Home\",\"latitude\":41.5,\"longitude\":29.25,\"isPin\":true},"
          + "{\"id\":\"c_1\",\"name\":\"İzmir\",\"latitude\":38.42,\"longitude\":27.14}]");
        List<WidgetCities.Place> again = WidgetCities.parse(WidgetCities.toJson(original));
        assertEquals(original.size(), again.size());
        for (int i = 0; i < original.size(); i++) {
            assertEquals(original.get(i).id, again.get(i).id);
            assertEquals(original.get(i).name, again.get(i).name);
            assertEquals(original.get(i).latitude, again.get(i).latitude, 1e-9);
            assertEquals(original.get(i).longitude, again.get(i).longitude, 1e-9);
            assertEquals(original.get(i).isPin, again.get(i).isPin);
        }
    }

    @Test
    public void theStoredFormIsCanonicalSoAnUnchangedListIsRecognisedAsUnchanged() {
        // The bridge compares the stored string with the new one to decide whether a refresh is needed.
        String a = WidgetCities.toJson(WidgetCities.parse("[{\"id\":\"x\",\"name\":\"X\",\"latitude\":1.0,\"longitude\":2.0,\"extra\":\"ignored\"}]"));
        String b = WidgetCities.toJson(WidgetCities.parse("[{\"longitude\":2,\"latitude\":1,\"name\":\"X\",\"id\":\"x\"}]"));
        assertEquals(a, b);
    }
}
