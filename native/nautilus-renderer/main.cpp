// IRBIS persistent Nautilus renderer — long-lived EnChartDisplay + stdin JSON IPC.
// APIs taken from SDK PrintChart / PickChart examples (no invented Kernel methods).
#include <QCoreApplication>
#include <QGuiApplication>
#include <QImage>
#include <QDir>
#include <QFileInfo>

#include <enkernel.h>
#include <enkernelconfiguration.h>
#include <enexception.h>
#include <enchartdisplay.h>
#include <encairopaintertarget.h>
#include <enpickreport.h>
#include <enpickreportfeature.h>
#include <enpickreportattribute.h>
#include <engeopoint.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#ifndef QT_PLUGIN_DIR
#define QT_PLUGIN_DIR "."
#endif

namespace {

std::string jsonEscape(const std::wstring &w)
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
      char buf[16];
      std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c & 0xffff));
      out += buf;
    }
    else
      out.push_back(static_cast<char>(c));
  }
  return out;
}

std::string toUtf8(const Nautilus::EnString &s)
{
  return jsonEscape(s.ToStdWString());
}

bool extractString(const std::string &line, const char *key, std::string &out)
{
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = line.find(needle);
  if (pos == std::string::npos)
    return false;
  pos = line.find(':', pos + needle.size());
  if (pos == std::string::npos)
    return false;
  pos = line.find('"', pos + 1);
  if (pos == std::string::npos)
    return false;
  ++pos;
  std::string value;
  while (pos < line.size())
  {
    char c = line[pos++];
    if (c == '\\' && pos < line.size())
    {
      value.push_back(line[pos++]);
      continue;
    }
    if (c == '"')
      break;
    value.push_back(c);
  }
  out = value;
  return true;
}

bool extractNumber(const std::string &line, const char *key, double &out)
{
  const std::string needle = std::string("\"") + key + "\"";
  auto pos = line.find(needle);
  if (pos == std::string::npos)
    return false;
  pos = line.find(':', pos + needle.size());
  if (pos == std::string::npos)
    return false;
  ++pos;
  while (pos < line.size() && (line[pos] == ' ' || line[pos] == '\t'))
    ++pos;
  try
  {
    size_t consumed = 0;
    out = std::stod(line.substr(pos), &consumed);
    return consumed > 0;
  }
  catch (...)
  {
    return false;
  }
}

bool extractInt(const std::string &line, const char *key, int &out)
{
  double d = 0;
  if (!extractNumber(line, key, d))
    return false;
  out = static_cast<int>(d);
  return true;
}

void writeLine(const std::string &json)
{
  std::cout << json << std::endl;
  std::cout.flush();
}

void replyOk(int requestId, const std::string &body)
{
  std::ostringstream o;
  o << "{\"ok\":true,\"requestId\":" << requestId << body << "}";
  writeLine(o.str());
}

void replyErr(int requestId, const std::string &msg)
{
  std::ostringstream o;
  o << "{\"ok\":false,\"requestId\":" << requestId << ",\"error\":\"" << jsonEscape(std::wstring(msg.begin(), msg.end()))
    << "\"}";
  writeLine(o.str());
}

struct Session
{
  std::unique_ptr<Nautilus::Portrayal::EnChartDisplay> display;
  std::shared_ptr<Nautilus::EnByteArray> cairoBuffer;
  unsigned width = 0;
  unsigned height = 0;
  unsigned dpi = 96;
  std::string cellPath;
  bool cellLoaded = false;
  double north = 0, south = 0, west = 0, east = 0;
  bool hasViewport = false;

  bool ensureTarget(unsigned w, unsigned h, unsigned d)
  {
    if (!display)
      display = std::make_unique<Nautilus::Portrayal::EnChartDisplay>();

    if (cairoBuffer && width == w && height == h && dpi == d)
      return true;

    width = w;
    height = h;
    dpi = d ? d : 96;
    const qreal physW = (static_cast<qreal>(width) / dpi) * 25.4;
    const qreal physH = (static_cast<qreal>(height) / dpi) * 25.4;
    cairoBuffer = std::make_shared<Nautilus::EnByteArray>(width * height);
    auto *target = display->CreatePortrayalTarget<Nautilus::Draw::Cairo::EnCairoPainterTarget>(
      cairoBuffer,
      Nautilus::Draw::EnPortrayalTarget::LogicalSize{ width, height },
      Nautilus::Draw::EnPortrayalTarget::PhysicalSize{ physW, physH });
    return target != nullptr;
  }

  void applyDefaultSettings()
  {
    try
    {
      Nautilus::Portrayal::EnPortrayalContext ctx = display->GetSymbolizeContext("IHO.ENC.2.0");
      ctx.SetDisplayMode(Nautilus::Portrayal::EnDisplayMode::DisplayCategory::Standard);
      ctx.SetViewingGroup(33010, true);
      ctx.SetViewingGroup(33020, true);
      ctx.SetViewingGroup(33021, true);
      ctx.SetViewingGroup(33022, true);
      ctx.ShowTwoShades(false);
      ctx.SetTextCategory(Nautilus::Portrayal::EnPortrayalContext::TextCategory::Other);
      display->SetSymbolizeContext({ "IHO.ENC.2.0" }, ctx);
      display->SetPalette(Nautilus::Portrayal::EnPalette::Day);
    }
    catch (...)
    {
    }
  }

  void setViewportDeg(double n, double s, double w, double e)
  {
    north = n;
    south = s;
    west = w;
    east = e;
    Nautilus::Geodesy::EnGeoRectangle box(
      Nautilus::EN_PI * south / 180.0,
      Nautilus::EN_PI * west / 180.0,
      Nautilus::EN_PI * north / 180.0,
      Nautilus::EN_PI * east / 180.0);
    const auto c_r2d = 180.0 / Nautilus::EN_PI;
    auto center = box.GetCenter();
    Nautilus::EnFloat64 range = box.GetHeight() * c_r2d * 60.0 / 2.0 * 1852.0;
    auto vp = display->GetViewPort();
    vp.Init(center, range, 0.0);
    display->SetViewPort(vp);
    hasViewport = true;
  }

  void fitToCell()
  {
    Nautilus::Geodesy::EnGeoRectangle box;
    auto num = display->DataSetCount();
    for (auto i = 0U; i < num; ++i)
    {
      auto dataSet = display->GetDataSet(i);
      if (dataSet)
        box.AddRect(dataSet->GetBoundingRectangle());
    }
    const auto c_r2d = 180.0 / Nautilus::EN_PI;
    north = box.GetNorth() * c_r2d;
    south = box.GetSouth() * c_r2d;
    west = box.GetWest() * c_r2d;
    east = box.GetEast() * c_r2d;
    setViewportDeg(north, south, west, east);
  }
};

} // namespace

int main(int argc, char **argv)
{
  QCoreApplication::setApplicationName("nautilus-renderer");
  QCoreApplication::addLibraryPath(QT_PLUGIN_DIR);
  QGuiApplication app(argc, argv);

  std::cerr << "nautilus-renderer ready (stdin JSON lines)" << std::endl;

  try
  {
    Nautilus::EnKernel::Instance()->Init(Nautilus::EnDevelopmentConfiguration());
  }
  catch (const Nautilus::EnException &exc)
  {
    std::cerr << "Kernel init failed: " << exc.GetInfo() << std::endl;
    writeLine("{\"ok\":false,\"error\":\"kernel_init_failed\"}");
    return 2;
  }

  Session session;
  writeLine("{\"ok\":true,\"event\":\"ready\",\"version\":\"1.0\"}");

  std::string line;
  while (std::getline(std::cin, line))
  {
    if (line.empty())
      continue;

    int requestId = 0;
    extractInt(line, "requestId", requestId);

    std::string cmd;
    if (!extractString(line, "cmd", cmd))
    {
      replyErr(requestId, "missing cmd");
      continue;
    }

    try
    {
      if (cmd == "ping")
      {
        replyOk(requestId, ",\"pong\":true");
        continue;
      }
      if (cmd == "quit")
      {
        replyOk(requestId, ",\"bye\":true");
        break;
      }
      if (cmd == "loadCell")
      {
        std::string path;
        if (!extractString(line, "path", path))
        {
          replyErr(requestId, "missing path");
          continue;
        }
        int w = 1280, h = 720, d = 96;
        extractInt(line, "width", w);
        extractInt(line, "height", h);
        extractInt(line, "dpi", d);
        // Fresh display for new cell to avoid stacking datasets.
        session.display = std::make_unique<Nautilus::Portrayal::EnChartDisplay>();
        session.cairoBuffer.reset();
        if (!session.ensureTarget(static_cast<unsigned>(w), static_cast<unsigned>(h), static_cast<unsigned>(d)))
        {
          replyErr(requestId, "target_create_failed");
          continue;
        }
        const QString qpath = QString::fromUtf8(path.c_str());
        auto dataSet = Nautilus::DataAccess::EnDataSet::Load(Nautilus::EnString(qpath.toStdWString()));
        session.display->AddDataSet(dataSet, 0);
        session.applyDefaultSettings();
        session.cellPath = path;
        session.cellLoaded = true;
        session.fitToCell();
        std::ostringstream body;
        body << ",\"cell\":\"" << jsonEscape(qpath.toStdWString()) << "\""
             << ",\"viewport\":{\"north\":" << session.north << ",\"south\":" << session.south
             << ",\"west\":" << session.west << ",\"east\":" << session.east << "}";
        replyOk(requestId, body.str());
        continue;
      }
      if (cmd == "setViewport")
      {
        if (!session.cellLoaded)
        {
          replyErr(requestId, "no_cell");
          continue;
        }
        double n = 0, s = 0, w = 0, e = 0;
        int width = static_cast<int>(session.width), height = static_cast<int>(session.height), dpi = static_cast<int>(session.dpi);
        if (!(extractNumber(line, "north", n) && extractNumber(line, "south", s) && extractNumber(line, "west", w) &&
              extractNumber(line, "east", e)))
        {
          replyErr(requestId, "viewport_fields");
          continue;
        }
        extractInt(line, "width", width);
        extractInt(line, "height", height);
        extractInt(line, "dpi", dpi);
        if (!session.ensureTarget(static_cast<unsigned>(width), static_cast<unsigned>(height), static_cast<unsigned>(dpi)))
        {
          replyErr(requestId, "target_create_failed");
          continue;
        }
        session.setViewportDeg(n, s, w, e);
        replyOk(requestId, ",\"viewportSet\":true");
        continue;
      }
      if (cmd == "render")
      {
        if (!session.cellLoaded || !session.hasViewport)
        {
          replyErr(requestId, "not_ready");
          continue;
        }
        std::string outPath;
        if (!extractString(line, "out", outPath))
        {
          replyErr(requestId, "missing out");
          continue;
        }
        QFileInfo fi(QString::fromStdString(outPath));
        QDir().mkpath(fi.absolutePath());

        const auto t0 = std::chrono::steady_clock::now();
        session.display->Draw(nullptr, nullptr, true);
        QImage qImage(static_cast<const uchar *>(session.cairoBuffer->data()),
                      static_cast<int>(session.width), static_cast<int>(session.height),
                      QImage::Format_ARGB32_Premultiplied);
        const QString qOut = QString::fromUtf8(outPath.c_str());
        if (!qImage.save(qOut))
        {
          replyErr(requestId, "png_save_failed");
          continue;
        }
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                          std::chrono::steady_clock::now() - t0)
                          .count();
        std::ostringstream body;
        body << ",\"png\":\"" << jsonEscape(qOut.toStdWString()) << "\""
             << ",\"ms\":" << ms
             << ",\"width\":" << session.width << ",\"height\":" << session.height
             << ",\"viewport\":{\"north\":" << session.north << ",\"south\":" << session.south
             << ",\"west\":" << session.west << ",\"east\":" << session.east << "}";
        replyOk(requestId, body.str());
        continue;
      }
      if (cmd == "pick")
      {
        if (!session.cellLoaded)
        {
          replyErr(requestId, "no_cell");
          continue;
        }
        int x = 0, y = 0, radius = 12;
        if (!(extractInt(line, "x", x) && extractInt(line, "y", y)))
        {
          replyErr(requestId, "pick_xy");
          continue;
        }
        extractInt(line, "radius", radius);
        // Ensure a drawn frame exists for pick geometry.
        session.display->Draw(nullptr, nullptr, true);
        Nautilus::Geometry::EnPoint pnt(x, y);
        auto report = session.display->GetPickReport(pnt, static_cast<unsigned>(radius));
        auto geo = session.display->DeviceToGeo(pnt);
        std::ostringstream body;
        body << ",\"geo\":{\"lat\":" << geo.GetLatDeg() << ",\"lon\":" << geo.GetLonDeg() << "}"
             << ",\"positionText\":\"" << toUtf8(report.GetPositionText()) << "\""
             << ",\"minDepth\":" << report.GetMinDepth()
             << ",\"maxDepth\":" << report.GetMaxDepth()
             << ",\"features\":[";
        const auto &features = report.GetFeatures();
        for (size_t i = 0; i < features.size(); ++i)
        {
          const auto &f = features[i];
          if (i)
            body << ",";
          body << "{\"name\":\"" << toUtf8(f->GetName()) << "\",\"primitive\":\""
               << toUtf8(f->GetGeometricPrimitiveText()) << "\",\"attributes\":[";
          const auto &attrs = f->GetAttributes();
          for (size_t a = 0; a < attrs.size(); ++a)
          {
            if (a)
              body << ",";
            body << "{\"name\":\"" << toUtf8(attrs[a]->GetName()) << "\",\"value\":\""
                 << toUtf8(attrs[a]->GetValue(0U)) << "\",\"type\":\"" << toUtf8(attrs[a]->GetTypeName())
                 << "\"}";
          }
          body << "]}";
        }
        body << "]";
        replyOk(requestId, body.str());
        continue;
      }

      replyErr(requestId, "unknown_cmd");
    }
    catch (const Nautilus::EnException &exc)
    {
      replyErr(requestId, std::string("nautilus:") + exc.GetInfo().ToStdString());
    }
    catch (const std::exception &exc)
    {
      replyErr(requestId, exc.what());
    }
  }

  return 0;
}
