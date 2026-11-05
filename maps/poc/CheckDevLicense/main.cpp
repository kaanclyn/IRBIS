// IRBIS local smoke test — EnDevelopmentConfiguration (eval / developer license)
#include <iomanip>
#include <iostream>
#include <sstream>

#include <enkernel.h>
#include <enkernelconfiguration.h>
#include <enexception.h>

int main()
{
  using namespace Nautilus;
  try
  {
    EnKernel::Instance()->Init(EnDevelopmentConfiguration());

    EnInt32 major = 0, minor = 0, patch = 0;
    EnKernel::Instance()->GetVersion(major, minor, patch);
    std::cout << "Nautilus version: " << major << '.' << minor << '.' << patch << std::endl;
    std::cout << "Runtime: " << EnKernel::Instance()->GetRuntimeRepository()->GetURI() << std::endl;
    std::cout << std::endl;
    std::cout << "Modules:" << std::endl;

    for (const EnKernel::Module & module : EnKernel::Instance()->Modules())
    {
      const EnString name = EnKernel::Instance()->GetModuleName(module);
      const bool on = EnKernel::Instance()->TestModule(module);
      std::cout << std::left << std::setw(28) << name.ToStdString()
                << (on ? "ENABLED" : "DISABLED") << std::endl;
    }

    std::cout << std::endl << "Development registration SUCCESS" << std::endl;
    EnKernel::Destroy();
    return 0;
  }
  catch (const EnException & exc)
  {
    std::cout << "Development registration FAILED" << std::endl;
    std::cout << exc.GetInfo().ToStdString() << std::endl;
    return 1;
  }
}
