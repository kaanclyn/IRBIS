// IRBIS PickChart — headless ENC pick via Nautilus EnChartDisplay::GetPickReport
// Based on SDK PrintChart + PickReport APIs (no invented methods).
#include <QCommandLineParser>
#include <QCoreApplication>
#include <QGuiApplication>
#include <QStringList>

#include <enkernel.h>
#include <enkernelconfiguration.h>
#include <enexception.h>
#include <enchartdisplay.h>
#include <encairopaintertarget.h>
#include <enpickreport.h>
#include <enpickreportfeature.h>
#include <enpickreportattribute.h>
#include <engeopoint.h>

#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include <memory>
#include <cmath>

#ifndef QT_PLUGIN_DIR
#define QT_PLUGIN_DIR "."
#endif

static std::string jsonEscape(const std::wstring &w)
{
  std::string out;
  out.reserve(w.size() + 8);
  for (wchar_t c : w)
  {
    if (c == L'\\' || c == L'"')
    {
      out.push_back('\\');
      out.push_back(static_cast<char>(c));
    }
    else if (c == L'\n')
      out += "\\n";
    else if (c == L'\r')
      out += "\\r";
    else if (c == L'\t')
      out += "\\t";
    else if (c < 32 || c > 126)
    {
      char buf[8];
      std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c & 0xffff));
      out += buf;
    }
    else
      out.push_back(static_cast<char>(c));
  }
  return out;
}

static std::string toUtf8(const Nautilus::EnString &s)
{
  return jsonEscape(s.ToStdWString());
}

int main(int argc, char **argv)
{
  QCoreApplication::setApplicationName("PickChart");
  QCoreApplication::addLibraryPath(QT_PLUGIN_DIR);
  QGuiApplication app(argc, argv);

  QCommandLineParser parser;
  parser.setApplicationDescription("Headless ENC pick → JSON (IRBIS)");
  parser.addHelpOption();
  parser.addOptions({
    { { "c", "cell" }, "Cell file path", "file" },
    { { "s", "size" }, "Image size WxH", "size", "1280x720" },
    { { "d", "dpi" }, "DPI", "dpi", "96" },
    { { "N", "North" }, "north lat deg", "lat" },
    { { "S", "South" }, "south lat deg", "lat" },
    { { "W", "West" }, "west lon deg", "lon" },
    { { "E", "East" }, "east lon deg", "lon" },
    { { "x", "pick-x" }, "pick x px", "x" },
    { { "y", "pick-y" }, "pick y px", "y" },
    { "json", "emit JSON on stdout" },
    { "cairo", "cairo painter (default)" },
  });

  if (!parser.parse(QCoreApplication::arguments()) || !parser.isSet("cell") ||
      !parser.isSet("North") || !parser.isSet("South") || !parser.isSet("West") ||
      !parser.isSet("East") || !parser.isSet("pick-x") || !parser.isSet("pick-y"))
  {
    std::cerr << parser.helpText().toStdString() << std::endl;
    return 1;
  }

  const QString cell = parser.value("cell");
  const int pickX = parser.value("pick-x").toInt();
  const int pickY = parser.value("pick-y").toInt();
  const unsigned dpi = parser.value("dpi").toUInt();

  QStringList sizeParts = parser.value("size").split("x");
  if (sizeParts.size() != 2)
  {
    std::cerr << "bad size" << std::endl;
    return 1;
  }
  const unsigned width = static_cast<unsigned>(std::abs(sizeParts[0].toInt()));
  const unsigned height = static_cast<unsigned>(std::abs(sizeParts[1].toInt()));

  Nautilus::EnFloat64 north = 0, south = 0, west = 0, east = 0;
  if (!(Nautilus::Geodesy::EnGeoPoint::ParseLatitude(Nautilus::EnString(parser.value("North").toStdWString()), north) &&
        Nautilus::Geodesy::EnGeoPoint::ParseLatitude(Nautilus::EnString(parser.value("South").toStdWString()), south) &&
        Nautilus::Geodesy::EnGeoPoint::ParseLongitude(Nautilus::EnString(parser.value("West").toStdWString()), west) &&
        Nautilus::Geodesy::EnGeoPoint::ParseLongitude(Nautilus::EnString(parser.value("East").toStdWString()), east)))
  {
    std::cerr << "viewport parse error" << std::endl;
    return 1;
  }

  try
  {
    Nautilus::EnKernel::Instance()->Init(Nautilus::EnDevelopmentConfiguration());

    auto chartDisplay = std::make_unique<Nautilus::Portrayal::EnChartDisplay>();
    auto cairoBuffer = std::make_shared<Nautilus::EnByteArray>(width * height);
    const qreal physW = (static_cast<qreal>(width) / dpi) * 25.4;
    const qreal physH = (static_cast<qreal>(height) / dpi) * 25.4;
    chartDisplay->CreatePortrayalTarget<Nautilus::Draw::Cairo::EnCairoPainterTarget>(
      cairoBuffer,
      Nautilus::Draw::EnPortrayalTarget::LogicalSize{ width, height },
      Nautilus::Draw::EnPortrayalTarget::PhysicalSize{ physW, physH });

    auto dataSet = Nautilus::DataAccess::EnDataSet::Load(Nautilus::EnString(cell.toStdWString()));
    chartDisplay->AddDataSet(dataSet, 0);

    Nautilus::Geodesy::EnGeoRectangle box(
      Nautilus::EN_PI * south / 180.0,
      Nautilus::EN_PI * west / 180.0,
      Nautilus::EN_PI * north / 180.0,
      Nautilus::EN_PI * east / 180.0);
    const auto c_r2d = 180.0 / Nautilus::EN_PI;
    auto center = box.GetCenter();
    Nautilus::EnFloat64 range = box.GetHeight() * c_r2d * 60.0 / 2.0 * 1852.0;
    auto vp = chartDisplay->GetViewPort();
    vp.Init(center, range, 0.0);
    chartDisplay->SetViewPort(vp);

    try
    {
      Nautilus::Portrayal::EnPortrayalContext ctx = chartDisplay->GetSymbolizeContext("IHO.ENC.2.0");
      ctx.SetDisplayMode(Nautilus::Portrayal::EnDisplayMode::DisplayCategory::Other);
      chartDisplay->SetSymbolizeContext({ "IHO.ENC.2.0" }, ctx);
      chartDisplay->SetPalette(Nautilus::Portrayal::EnPalette::Day);
    }
    catch (...)
    {
    }

    chartDisplay->Draw(nullptr, nullptr, true);

    Nautilus::Geometry::EnPoint pnt(pickX, pickY);
    auto report = chartDisplay->GetPickReport(pnt, 12U);
    auto geoFromDevice = chartDisplay->DeviceToGeo(pnt);

    std::ostringstream json;
    json << "{";
    json << "\"geo\":{\"lat\":" << geoFromDevice.GetLatDeg() << ",\"lon\":" << geoFromDevice.GetLonDeg() << "},";
    json << "\"positionText\":\"" << toUtf8(report.GetPositionText()) << "\",";
    json << "\"minDepth\":" << report.GetMinDepth() << ",";
    json << "\"maxDepth\":" << report.GetMaxDepth() << ",";
    json << "\"features\":[";

    const auto &features = report.GetFeatures();
    for (size_t i = 0; i < features.size(); ++i)
    {
      const auto &f = features[i];
      if (i) json << ",";
      json << "{";
      json << "\"name\":\"" << toUtf8(f->GetName()) << "\",";
      json << "\"primitive\":\"" << toUtf8(f->GetGeometricPrimitiveText()) << "\",";
      json << "\"attributes\":[";
      const auto &attrs = f->GetAttributes();
      for (size_t a = 0; a < attrs.size(); ++a)
      {
        if (a) json << ",";
        json << "{\"name\":\"" << toUtf8(attrs[a]->GetName()) << "\",";
        json << "\"value\":\"" << toUtf8(attrs[a]->GetValue(0U)) << "\",";
        json << "\"type\":\"" << toUtf8(attrs[a]->GetTypeName()) << "\"}";
      }
      json << "]}";
    }
    json << "]}";

    std::cout << json.str() << std::endl;
    return 0;
  }
  catch (const Nautilus::EnException &exc)
  {
    std::cerr << "Nautilus: " << exc.GetInfo() << std::endl;
    return 2;
  }
  catch (const std::exception &exc)
  {
    std::cerr << "error: " << exc.what() << std::endl;
    return 2;
  }
}
