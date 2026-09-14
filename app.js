(function () {
  "use strict";

  var rows = [];
  var threshold = 0;
  var resizeTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  var canvas = byId("plot");
  var status = byId("status");
  var startEl = byId("start");
  var endEl = byId("end");
  var loadBtn = byId("load");
  var saveBtn = byId("save");
  var summary = byId("summary");
  var subtitle = byId("subtitle");

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function roundToHour(date) {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      0,
      0,
      0
    );
  }

  function addHours(date, hours) {
    return new Date(date.getTime() + hours * 3600000);
  }

  function toInputValue(date) {
    return (
      date.getFullYear() + "-" +
      pad(date.getMonth() + 1) + "-" +
      pad(date.getDate()) + "T" +
      pad(date.getHours()) + ":00"
    );
  }

  function toDateValue(date) {
    return (
      date.getFullYear() + "-" +
      pad(date.getMonth() + 1) + "-" +
      pad(date.getDate())
    );
  }

  function parseTime(value) {
    var match = String(value).match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    );

    if (!match) {
      return null;
    }

    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      0,
      0
    );
  }

  function showStatus(text, type) {
    status.textContent = text;
    status.className = "status " + type;
  }

  function saturationPressure(temperature) {
    return 6.112 * Math.exp(
      17.62 * temperature / (243.12 + temperature)
    );
  }

  function mixingRatio(dewPoint, pressure) {
    var vaporPressure = saturationPressure(dewPoint);
    return 622 * vaporPressure / Math.max(pressure - vaporPressure, 0.000001);
  }

  function calculateMedian(values) {
    var sorted = values
      .filter(Number.isFinite)
      .slice()
      .sort(function (a, b) { return a - b; });

    if (!sorted.length) {
      return 1013.25;
    }

    var middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function calculateThreshold(pressure) {
    var vaporPressure = 0.40 * saturationPressure(22);
    return 622 * vaporPressure / Math.max(pressure - vaporPressure, 0.000001);
  }

  function buildUrl(baseUrl, start, end) {
    return (
      baseUrl +
      "?latitude=51.1328" +
      "&longitude=13.7672" +
      "&hourly=temperature_2m,dew_point_2m,surface_pressure" +
      "&timezone=Europe%2FBerlin" +
      "&start_date=" + toDateValue(start) +
      "&end_date=" + toDateValue(end)
    );
  }

  function parseResponse(data, source) {
    if (
      !data.hourly ||
      !Array.isArray(data.hourly.time) ||
      !Array.isArray(data.hourly.temperature_2m) ||
      !Array.isArray(data.hourly.dew_point_2m) ||
      !Array.isArray(data.hourly.surface_pressure)
    ) {
      throw new Error(source + ": unvollständige Stundenwerte");
    }

    var count = Math.min(
      data.hourly.time.length,
      data.hourly.temperature_2m.length,
      data.hourly.dew_point_2m.length,
      data.hourly.surface_pressure.length
    );

    var result = [];

    for (var index = 0; index < count; index++) {
      var time = parseTime(data.hourly.time[index]);
      var temperature = Number(data.hourly.temperature_2m[index]);
      var dewPoint = Number(data.hourly.dew_point_2m[index]);
      var pressure = Number(data.hourly.surface_pressure[index]);

      if (
        !time ||
        !Number.isFinite(temperature) ||
        !Number.isFinite(dewPoint) ||
        !Number.isFinite(pressure)
      ) {
        continue;
      }

      result.push({
        time: time,
        temp: temperature,
        pressure: pressure,
        humidity: mixingRatio(dewPoint, pressure),
        source: source
      });
    }

    return result;
  }

  function fetchRows(url, source) {
    return fetch(url, { cache: "no-store" })
      .then(function (response) {
        return response.text().then(function (body) {
          if (!response.ok) {
            throw new Error(source + ": HTTP " + response.status + " - " + body.slice(0, 160));
          }

          var data;
          try {
            data = JSON.parse(body);
          } catch (error) {
            throw new Error(source + ": Antwort war kein JSON - " + body.slice(0, 160));
          }

          return parseResponse(data, source);
        });
      });
  }

  function requestRecentAndFuture(start, end) {
    var now = roundToHour(new Date());
    var pastDays = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / 86400000));
    pastDays = Math.min(pastDays + 1, 14);

    var futureDays = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 86400000) + 1);
    futureDays = Math.min(futureDays, 16);

    var url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=51.1328" +
      "&longitude=13.7672" +
      "&hourly=temperature_2m,dew_point_2m,surface_pressure" +
      "&timezone=Europe%2FBerlin" +
      "&past_days=" + pastDays +
      "&forecast_days=" + futureDays;

    return fetchRows(url, "Aktuelle Wetterdaten");
  }

  function requestArchive(start, end) {
    var archiveUrl = buildUrl(
      "https://archive-api.open-meteo.com/v1/archive",
      start,
      end
    );

    return fetchRows(archiveUrl, "Historische Wetterdaten");
  }

  function validateRange(start, end) {
    if (!start || !end) {
      throw new Error("Bitte Anfang und Ende auswählen.");
    }

    if (end <= start) {
      throw new Error("Das Ende muss nach dem Anfang liegen.");
    }

    if (end.getTime() - start.getTime() > 14 * 86400000) {
      throw new Error("Der Zeitraum darf maximal 14 Tage betragen.");
    }
  }

  function loadRange() {
    var start = parseTime(startEl.value);
    var end = parseTime(endEl.value);

    try {
      validateRange(start, end);
    } catch (error) {
      showStatus(error.message, "error");
      return;
    }

    showStatus("Wetterdaten werden geladen ...", "loading");
    loadBtn.disabled = true;
    saveBtn.disabled = true;

    var now = roundToHour(new Date());
    var recentBoundary = addHours(now, -14 * 24);
    var jobs = [];

    if (start < recentBoundary) {
      var archiveEnd = end < recentBoundary ? end : addHours(recentBoundary, -1);
      jobs.push(requestArchive(start, archiveEnd));
    }

    if (end >= recentBoundary) {
      var recentStart = start > recentBoundary ? start : recentBoundary;
      jobs.push(requestRecentAndFuture(recentStart, end));
    }

    Promise.all(jobs)
      .then(function (parts) {
        var map = {};

        parts.forEach(function (part) {
          part.forEach(function (row) {
            var key = row.time.getTime();

            if (!map[key] || row.source === "Vorhersage") {
              map[key] = row;
            }
          });
        });

        rows = Object.keys(map)
          .map(function (key) { return map[key]; })
          .filter(function (row) {
            return row.time >= start && row.time <= end;
          })
          .sort(function (a, b) {
            return a.time.getTime() - b.time.getTime();
          });

        if (!rows.length) {
          throw new Error("Keine Daten im gewählten Zeitraum gefunden.");
        }

        threshold = calculateThreshold(
          calculateMedian(rows.map(function (row) { return row.pressure; }))
        );

        summary.textContent =
          rows.length + " Stundenwerte | Grenzwert " +
          threshold.toFixed(1) + " g/kg";

        subtitle.textContent =
          start.toLocaleString("de-DE") + " bis " +
          end.toLocaleString("de-DE");

        draw();
        saveBtn.disabled = false;
        showStatus("Daten erfolgreich geladen.", "success");
      })
      .catch(function (error) {
        console.error(error);
        showStatus("Fehler: " + error.message, "error");
      })
      .finally(function () {
        loadBtn.disabled = false;
      });
  }

  function draw() {
    if (!rows.length) {
      return;
    }

    var box = canvas.parentElement;
    var width = Math.max(box.clientWidth, 320);
    var height = Math.max(box.clientHeight, 420);
    var ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    var context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    var margin = { left: 65, right: 70, top: 30, bottom: 85 };
    var plotWidth = width - margin.left - margin.right;
    var plotHeight = height - margin.top - margin.bottom;

    var temperatures = rows.map(function (row) { return row.temp; });
    var humidities = rows.map(function (row) { return row.humidity; });

    var temperatureMin = Math.floor(Math.min.apply(null, temperatures) - 1);
    var temperatureMax = Math.ceil(Math.max.apply(null, temperatures) + 1);
    var humidityMin = Math.max(
      0,
      Math.floor(Math.min.apply(null, humidities.concat([threshold])) - 0.5)
    );
    var humidityMax = Math.ceil(
      Math.max.apply(null, humidities.concat([threshold])) + 0.5
    );

    if (temperatureMin === temperatureMax) { temperatureMax++; }
    if (humidityMin === humidityMax) { humidityMax++; }

    function x(index) {
      return margin.left + index / Math.max(rows.length - 1, 1) * plotWidth;
    }

    function temperatureY(value) {
      return margin.top +
        (temperatureMax - value) /
        (temperatureMax - temperatureMin) * plotHeight;
    }

    function humidityY(value) {
      return margin.top +
        (humidityMax - value) /
        (humidityMax - humidityMin) * plotHeight;
    }

    context.font = "12px Arial";

    for (var step = 0; step <= 6; step++) {
      var fraction = step / 6;
      var y = margin.top + fraction * plotHeight;

      context.strokeStyle = "rgba(0,0,0,0.12)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(margin.left, y);
      context.lineTo(margin.left + plotWidth, y);
      context.stroke();

      context.fillStyle = "#8b0000";
      context.textAlign = "right";
      context.fillText(
        (temperatureMax - fraction * (temperatureMax - temperatureMin)).toFixed(1),
        margin.left - 8,
        y + 4
      );

      context.fillStyle = "#16823b";
      context.textAlign = "left";
      context.fillText(
        (humidityMax - fraction * (humidityMax - humidityMin)).toFixed(1),
        margin.left + plotWidth + 8,
        y + 4
      );
    }

    rows.forEach(function (row, index) {
      var hourValue = row.time.getHours();

      if (![0, 6, 12, 18].includes(hourValue)) {
        return;
      }

      context.strokeStyle = hourValue === 0
        ? "rgba(0,0,0,0.5)"
        : "rgba(0,0,0,0.15)";

      context.setLineDash(hourValue === 0 ? [] : [3, 5]);
      context.beginPath();
      context.moveTo(x(index), margin.top);
      context.lineTo(x(index), margin.top + plotHeight);
      context.stroke();

      if (hourValue !== 0 || rows.length < 200) {
        context.setLineDash([]);
        context.fillStyle = "#555555";
        context.textAlign = "center";
        context.fillText(
          pad(hourValue) + ":00",
          x(index),
          margin.top + plotHeight + 18
        );
      }
    });

    context.setLineDash([]);

    function drawLine(values, yFunction, color) {
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();

      values.forEach(function (value, index) {
        if (index === 0) {
          context.moveTo(x(index), yFunction(value));
        } else {
          context.lineTo(x(index), yFunction(value));
        }
      });

      context.stroke();
    }

    drawLine(temperatures, temperatureY, "#8b0000");
    drawLine(humidities, humidityY, "#16823b");

    context.strokeStyle = "#e02020";
    context.setLineDash([8, 6]);
    context.beginPath();
    context.moveTo(margin.left, humidityY(threshold));
    context.lineTo(margin.left + plotWidth, humidityY(threshold));
    context.stroke();
    context.setLineDash([]);

    context.strokeStyle = "#555555";
    context.strokeRect(margin.left, margin.top, plotWidth, plotHeight);

    var lastDate = "";

    rows.forEach(function (row, index) {
      var key = toDateValue(row.time);

      if (key === lastDate) {
        return;
      }

      lastDate = key;
      context.fillStyle =
        row.time.getDay() === 0 || row.time.getDay() === 6
          ? "#8b0000"
          : "#222222";
      context.textAlign = "center";
      context.font = rows.length > 240 ? "bold 10px Arial" : "bold 11px Arial";
      context.fillText(
        row.time.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit"
        }),
        x(index),
        margin.top + plotHeight + 48
      );
    });

    context.font = "12px Arial";
    context.fillStyle = "#444444";
    context.textAlign = "center";
    context.fillText("Ortszeit Dresden", margin.left + plotWidth / 2, height - 12);
  }

  function quickRange(hours, past) {
    var now = roundToHour(new Date());
    var start = past ? addHours(now, -hours) : now;
    var end = past ? now : addHours(now, hours);

    startEl.value = toInputValue(start);
    endEl.value = toInputValue(end);
    loadRange();
  }

  loadBtn.addEventListener("click", loadRange);

  saveBtn.addEventListener("click", function () {
    var link = document.createElement("a");
    link.download = "wetterplot-dresden.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  document.querySelectorAll("[data-hours]").forEach(function (button) {
    button.addEventListener("click", function () {
      quickRange(
        Number(button.getAttribute("data-hours")),
        button.getAttribute("data-past") === "1"
      );
    });
  });

  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(draw, 150);
  });

  var now = roundToHour(new Date());
  startEl.value = toInputValue(now);
  endEl.value = toInputValue(addHours(now, 168));
  showStatus("JavaScript funktioniert. Wetterdaten werden geladen ...", "loading");
  loadRange();
})();
